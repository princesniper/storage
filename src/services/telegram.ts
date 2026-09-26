/**
 * TelegramService — isolated GramJS client wrapper.
 *
 * Architecture notes:
 * - One persistent TelegramClient per Node process (GramJS is not stateless).
 * - Session is loaded from DB on boot, encrypted with AES-256-GCM.
 * - Session string is NEVER logged, NEVER returned to client.
 * - All operations run server-side only.
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptSession, decryptSession } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";

export type TelegramStatus = "disconnected" | "connecting" | "connected" | "pending_2fa" | "error";

type Pending2FA = {
  phoneCodeHash: string;
  phone: string;
};

class TelegramServiceImpl {
  private client: TelegramClient | null = null;
  private status: TelegramStatus = "disconnected";
  private lastError: string | null = null;
  private pending2FA: Pending2FA | null = null;
  private bootPromise: Promise<void> | null = null;
  private readonly sessionFile = process.env.TELEGRAM_DEV_SESSION_FILE || ".data/telegram-dev.session";

  getStatus(): TelegramStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getClient(): TelegramClient {
    if (!this.client) {
      throw new Error("Telegram client not initialized. Call start() first.");
    }
    return this.client;
  }

  /**
   * Boot hook — call once on server startup, OR lazily on first use.
   * If a connected TelegramAccount row exists, decrypt and load the session.
   */
  async start(): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = this.boot();
    return this.bootPromise;
  }

  /**
   * Force the service to attempt a boot before any operation.
   * Safe to call multiple times — only boots once.
   *
   * Public so status/health/media-serving paths can ensure the stored
   * session has been loaded before reading getStatus(). Without this,
   * a fresh server process always reports "disconnected" (and media
   * serving returns 502) until the first upload/test triggers a boot.
   */
  async ensureStarted(): Promise<void> {
    return this.ensureBooted();
  }

  private async ensureBooted(): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    return this.start();
  }

  private async boot(): Promise<void> {
    try {
      // Development uses a separate, file-backed session so local restarts stay
      // authenticated without ever reading or overwriting the production DB session.
      if (process.env.NODE_ENV !== "production") {
        const { existsSync, mkdirSync, readFileSync } = await import("fs");
        const { dirname } = await import("path");
        let sessionString = "";
        if (existsSync(this.sessionFile)) {
          sessionString = readFileSync(this.sessionFile, "utf8").trim();
          logger.info("TelegramService: loading isolated development session");
        } else {
          logger.info("TelegramService: no isolated development session, waiting for connect");
        }
        this.client = new TelegramClient(
          new StringSession(sessionString),
          env.TELEGRAM_API_ID,
          env.TELEGRAM_API_HASH,
          { connectionRetries: 5, useWSS: true }
        );
        await this.client.connect();
        if (!sessionString) {
          this.status = "disconnected";
          return;
        }
        const authorized = await this.client.checkAuthorization();
        if (!authorized) {
          this.status = "disconnected";
          this.client = null;
          logger.warn("TelegramService: isolated development session is not authorized");
          return;
        }
        this.status = "connected";
        return;
      }

      const acc = await db.telegramAccount.findFirst({
        orderBy: { updatedAt: "desc" },
      });
      if (!acc || !acc.sessionCipher || !acc.sessionIV || !acc.sessionAuthTag) {
        logger.info("TelegramService: no stored session, waiting for connect");
        this.status = "disconnected";
        return;
      }
      const sessionString = decryptSession({
        cipherB64: acc.sessionCipher,
        ivB64: acc.sessionIV,
        authTagB64: acc.sessionAuthTag,
      });
      this.client = new TelegramClient(
        new StringSession(sessionString),
        env.TELEGRAM_API_ID,
        env.TELEGRAM_API_HASH,
        { connectionRetries: 5, useWSS: true }
      );
      await this.client.connect();
      const authorized = await this.client.checkAuthorization();
      if (!authorized) {
        logger.warn("TelegramService: session present but not authorized — clearing");
        await db.telegramAccount.update({
          where: { id: acc.id },
          data: {
            status: "disconnected",
            sessionCipher: null,
            sessionIV: null,
            sessionAuthTag: null,
            lastError: "Session not authorized",
          },
        });
        this.status = "disconnected";
        this.client = null;
        return;
      }
      this.status = "connected";
      await db.telegramAccount.update({
        where: { id: acc.id },
        data: { status: "connected", lastConnectedAt: new Date(), lastError: null },
      });
      logger.info("TelegramService: connected with stored session");
    } catch (err) {
      this.status = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      if (this.client) {
        try { await this.client.disconnect(); } catch {}
      }
      this.client = null;
      logger.error("TelegramService boot failed", { err: this.lastError });
    }
  }

  /**
   * Step 1 of connect flow: send OTP to phone.
   *
   * Always uses a fresh GramJS client. The normal production client may
   * contain an already-authorized stored session and must not be reused
   * for a new phone-number login flow.
   */
  async requestCode(phone: string): Promise<{ phoneCodeHash: string }> {
    const normalizedPhone = phone.trim();
    if (!normalizedPhone) throw new Error("Phone number is required");

    if (this.client) {
      try { await this.client.disconnect(); } catch {}
      this.client = null;
    }
    this.bootPromise = null;
    this.status = "connecting";
    this.lastError = null;

    const result = await this.ensureFreshClient(normalizedPhone);
    this.pending2FA = { phoneCodeHash: result.phoneCodeHash, phone: normalizedPhone };
    return result;
  }

  /**
   * Step 2 of connect flow: verify OTP. If account has 2FA, returns { needs2fa: true }.
   */
  async verifyCode(phone: string, code: string, phoneCodeHash: string): Promise<{ needs2fa: boolean }> {
    if (!this.client) throw new Error("Telegram client not ready");
    try {
      await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code,
        })
      );
      // Success — no 2FA needed
      const sessionString = this.client.session.save() as unknown as string;
      await this.persistSession(phone, sessionString);
      this.status = "connected";
      this.pending2FA = null;
      return { needs2fa: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        this.status = "pending_2fa";
        this.pending2FA = { phoneCodeHash, phone };
        return { needs2fa: true };
      }
      throw err;
    }
  }

  /**
   * Step 3 (optional) — only if 2FA enabled.
   */
  async verify2fa(password: string): Promise<void> {
    if (!this.client || !this.pending2FA) throw new Error("No pending 2FA flow");
    await this.client.signInWithPassword(
      { apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH },
      {
        password: async () => password,
        onError: async (err: Error) => {
          logger.error("2FA error", { err: err.message });
          return true; // abort flow
        },
      }
    );
    const sessionString = this.client.session.save() as unknown as string;
    await this.persistSession(this.pending2FA.phone, sessionString);
    this.status = "connected";
    this.pending2FA = null;
  }

  /**
   * Disconnect: clear session from DB and in-memory.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        logger.warn("TelegramService disconnect error", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.client = null;
    this.status = "disconnected";
    this.pending2FA = null;
    await db.telegramAccount.updateMany({
      data: {
        status: "disconnected",
        sessionCipher: null,
        sessionIV: null,
        sessionAuthTag: null,
        phoneReference: null,
        lastError: null,
      },
    });
    logger.info("TelegramService: disconnected and session cleared");
  }

  /**
   * Resolve a stored channel id (e.g. "-1001234567890", kept as a string)
   * to an input entity. Wraps GramJS errors with an actionable message —
   * callers surface `detail` to the dashboard instead of a bare 500/502.
   */
  private async resolvePeer(peerId: string) {
    if (!this.client) throw new Error(this.notConnectedMessage());
    try {
      return await this.client.getInputEntity(peerId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not resolve Telegram channel ${peerId}: ${msg}. ` +
          `Ensure the connected account is a member/admin of the channel and the ID is correct.`
      );
    }
  }

  /** Generic "not connected" error that includes the boot failure, if any. */
  private notConnectedMessage(): string {
    return this.lastError
      ? `Telegram not connected: ${this.lastError}`
      : "Telegram not connected. Connect an account in Settings first.";
  }

  /**
   * Upload a file to a channel. Returns the message id and media pointers.
   * Pass the raw Buffer; set name attribute for filename.
   */
  async uploadFile(
    peerId: string,
    buf: Buffer,
    mimeType: string,
    originalName: string,
    onProgress?: (progress: number) => void
  ): Promise<{
    messageId: number;
    fileId: string;
    accessHash: string;
    fileReference: string; // base64
  }> {
    await this.ensureConnectedClient();
    if (!this.client) throw new Error(this.notConnectedMessage());

    const peer = await this.resolvePeer(peerId);

    // GramJS switches files over 20 MB to its chunked/large-file path and,
    // in that path, CustomFile.path is required. A blank path causes the
    // exact "Either one of buffer or filePath" error seen for 34.9 MB videos.
    // Always provide a real temporary path for large uploads; keep the Buffer
    // for smaller files so the common path stays memory-only.
    const needsLargeFilePath = buf.length > 20 * 1024 * 1024;
    const tempPath = needsLargeFilePath
      ? path.join(os.tmpdir(), `telegram-upload-${randomBytes(8).toString("hex")}-${path.basename(originalName)}`)
      : "";
    if (needsLargeFilePath) {
      await fs.writeFile(tempPath, buf);
    }
    const telegramFile = new CustomFile(
      originalName,
      buf.length,
      tempPath,
      needsLargeFilePath ? undefined : buf
    );

    // Telegram may temporarily reject rapid uploads with FLOOD_WAIT.
    // Back off using the exact server-provided delay instead of returning a
    // misleading generic HTTP 502 to the browser.
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sent = await this.client.sendFile(peer, {
          file: telegramFile,
          progressCallback: onProgress,

          caption: originalName,
          forceDocument: true,
          fileSize: buf.length,
        });
          return this.extractMessageRef(sent);
        } catch (err) {
          const waitSeconds = this.getFloodWaitSeconds(err);
          if (waitSeconds != null && attempt < 2) {
            logger.warn("Telegram upload rate limited; backing off", {
            peerId,
            originalName,
            waitSeconds,
            attempt: attempt + 1,
            });
            await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
            continue;
          }

          // A long-lived server can lose its MTProto socket between requests.
          // Reconnect once and retry before surfacing the real Telegram error.
          if (attempt === 0 && this.client && !this.client.connected) {
            logger.warn("Telegram upload client disconnected; reconnecting", { originalName });
            await this.ensureConnectedClient(true);
            continue;
          }
          throw err;
        }
      }

      throw new Error("Telegram upload failed after retries");
    } finally {
      if (tempPath) {
        try { await fs.unlink(tempPath); } catch {}
      }
    }
  }

  /**
   * Extract file reference from a GramJS Message.
   */
  private extractMessageRef(msg: Api.Message): {
    messageId: number;
    fileId: string;
    accessHash: string;
    fileReference: string; // base64
  } {
    const media = msg.media as
      | (Api.MessageMediaDocument & {
        document?: Api.Document & {
          id: { toString(): string };
          accessHash: { toString(): string };
          fileReference: Buffer;
        };
      })
      | undefined;
    const doc = media?.document;
    if (!doc) {
      throw new Error("Uploaded message has no document media");
    }
    return {
      messageId: msg.id,
      fileId: doc.id.toString(),
      accessHash: doc.accessHash.toString(),
      fileReference: doc.fileReference.toString("base64"),
    };
  }

  /**
   * Download a file. Refreshes fileReference if expired.
   */
  async downloadFile(
    peerId: string,
    messageId: number,
    currentFileReferenceB64: string
  ): Promise<{ bytes: Buffer; refreshedReferenceB64?: string }> {
    await this.start();
    if (this.status !== "connected" || !this.client) {
      throw new Error(this.notConnectedMessage());
    }
    const peer = await this.resolvePeer(peerId);

    // Fetch the message fresh — gives us a working fileReference.
    // GramJS doesn't expose a clean "download from raw fileReference" API.
    const msgs = await this.client.getMessages(peer, { ids: [messageId], limit: 1 });
    const fresh = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!fresh) throw new Error("Message not found");

    const media = fresh.media as
      | (Api.MessageMediaDocument & {
        document?: Api.Document & {
          id: { toString(): string };
          accessHash: { toString(): string };
          fileReference: Buffer;
        };
      })
      | undefined;
    const doc = media?.document;
    if (!doc) throw new Error("Message has no media document");

    const newRef = doc.fileReference.toString("base64");
    // If current fileReference still valid, skip refresh persist; otherwise mark refreshed.
    const refreshed = newRef !== currentFileReferenceB64;

    const buf = (await this.client.downloadMedia(fresh)) as Buffer | undefined;
    if (!buf) throw new Error("download returned empty");
    return {
      bytes: buf,
      refreshedReferenceB64: refreshed ? newRef : undefined,
    };
  }

  /**
   * Delete a message in a channel.
   */
  async deleteMessage(peerId: string, messageId: number): Promise<void> {
    await this.start();
    if (!this.client) throw new Error(this.notConnectedMessage());
    const peer = await this.resolvePeer(peerId);
    await this.client.deleteMessages(peer, [messageId], { revoke: true });
  }

  /**
   * Test access to a channel: try to fetch entity and send + delete a tiny test message.
   */
  async testChannel(peerId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    await this.start();
    if (!this.client) return { ok: false, latencyMs: 0, error: this.notConnectedMessage() };
    const start = Date.now();
    try {
      const peer = await this.resolvePeer(peerId);
      const testMsg = await this.client.sendMessage(peer, {
        message: "[Connection test] This message will be deleted automatically.",
      });
      await this.client.deleteMessages(peer, [testMsg.id], { revoke: true });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private getFloodWaitSeconds(err: unknown): number | null {
    const message = err instanceof Error ? err.message : String(err);
    const match = message.match(/FLOOD_WAIT[_ ]?(\d+)/i);
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : null;
  }

  private async ensureConnectedClient(forceReconnect = false): Promise<void> {
    await this.ensureBooted();
    if (!forceReconnect && this.client && this.status === "connected" && this.client.connected) {
      return;
    }
    if (forceReconnect && this.client) {
      try { await this.client.disconnect(); } catch {}
      this.client = null;
      this.status = "disconnected";
      this.bootPromise = null;
    }
    await this.start();
    if (!this.client || this.status !== "connected" || !this.client.connected) {
      throw new Error(this.notConnectedMessage());
    }
  }

  /**
   * Create a fresh, connected client for the phone-number OTP flow.
   * This deliberately does not load the stored authorized session.
   */
  private async ensureFreshClient(phone: string): Promise<{ phoneCodeHash: string }> {
    const client = new TelegramClient(
      new StringSession(""),
      env.TELEGRAM_API_ID,
      env.TELEGRAM_API_HASH,
      { connectionRetries: 5, useWSS: true }
    );

    try {
      await client.connect();
      if (!client.connected) {
        throw new Error("Telegram client connected unsuccessfully");
      }
      const result = await client.sendCode(
        { apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH },
        phone
      );
      this.client = client;
      this.status = "connecting";
      return result;
    } catch (err) {
      try { await client.disconnect(); } catch {}
      this.status = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      throw new Error("Telegram OTP request failed: " + this.lastError);
    }
  }

  private async persistSession(phone: string, sessionString: string): Promise<void> {
    // Local development uses its own file-backed GramJS session. It is never
    // written to the shared production database, preventing AUTH_KEY_DUPLICATED.
    if (process.env.NODE_ENV !== "production") {
      const { mkdirSync, writeFileSync } = await import("fs");
      const { dirname } = await import("path");
      mkdirSync(dirname(this.sessionFile), { recursive: true });
      writeFileSync(this.sessionFile, sessionString, { encoding: "utf8", mode: 0o600 });
      logger.info("TelegramService: isolated development session persisted");
      return;
    }

    const enc = encryptSession(sessionString);
    const phoneRef = phone.length >= 4
      ? `+${"*".repeat(Math.max(0, phone.length - 5))}${phone.slice(-4)}`
      : phone;
    const existing = await db.telegramAccount.findFirst();
    if (existing) {
      await db.telegramAccount.update({
        where: { id: existing.id },
        data: {
          sessionCipher: enc.cipherB64,
          sessionIV: enc.ivB64,
          sessionAuthTag: enc.authTagB64,
          phoneReference: phoneRef,
          apiId: env.TELEGRAM_API_ID,
          status: "connected",
          lastConnectedAt: new Date(),
          lastError: null,
        },
      });
    } else {
      await db.telegramAccount.create({
        data: {
          name: "Primary",
          sessionCipher: enc.cipherB64,
          sessionIV: enc.ivB64,
          sessionAuthTag: enc.authTagB64,
          phoneReference: phoneRef,
          apiId: env.TELEGRAM_API_ID,
          status: "connected",
          lastConnectedAt: new Date(),
        },
      });
    }
  }
}

// Singleton — shared across hot-reloads
const globalForTelegram = globalThis as unknown as { __telegramService?: TelegramServiceImpl };

export const telegramService =
  globalForTelegram.__telegramService ?? new TelegramServiceImpl();

if (process.env.NODE_ENV !== "production") {
  globalForTelegram.__telegramService = telegramService;
}
