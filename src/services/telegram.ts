/**
 * TelegramService — isolated GramJS client wrapper.
 *
 * Architecture notes:
 * - One persistent TelegramClient per Node process (GramJS is not stateless).
 * - Session is loaded from DB on boot, encrypted with AES-256-GCM.
 * - Session string is NEVER logged, NEVER returned to client.
 * - All operations run server-side only.
 */
import bigInt from "big-integer";
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

type UploadProgressState = { progress: number; stage: "telegram" | "complete" | "failed" | "duplicate"; updatedAt: number; fileUrl?: string; error?: string };
const globalForUploadProgress = globalThis as unknown as { __uploadProgress?: Map<string, UploadProgressState> };
const uploadProgress = globalForUploadProgress.__uploadProgress ?? new Map<string, UploadProgressState>();
globalForUploadProgress.__uploadProgress = uploadProgress;

export function setTelegramUploadProgress(id: string, progress: number, stage: UploadProgressState["stage"]) {
  uploadProgress.set(id, { progress: Math.max(0, Math.min(100, progress)), stage, updatedAt: Date.now() });
}

export function getTelegramUploadProgress(id: string) {
  const value = uploadProgress.get(id);
  if (!value) return null;
  if (Date.now() - value.updatedAt > 30 * 60 * 1000) {
    uploadProgress.delete(id);
    return null;
  }
  return value;
}

export function clearTelegramUploadProgress(id: string) {
  uploadProgress.delete(id);
}

export function setTelegramUploadResult(id: string, fileUrl: string) {
  uploadProgress.set(id, { progress: 100, stage: "complete", updatedAt: Date.now(), fileUrl });
}

export function setTelegramUploadFailure(id: string, error: string) {
  uploadProgress.set(id, { progress: 0, stage: "failed", updatedAt: Date.now(), error });
}

export function setTelegramUploadDuplicate(id: string, message: string, fileUrl?: string) {
  uploadProgress.set(id, { progress: 0, stage: "duplicate", updatedAt: Date.now(), error: message, fileUrl });
}

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
    // A single boot promise must own session initialization. Retrying by
    // clearing bootPromise here can create a second TelegramClient with the
    // same session while the first one is still alive, which produces
    // AUTH_KEY_DUPLICATED and turns media reads into 502s.
    await this.ensureBooted();
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
          { connectionRetries: 10, reconnectRetries: 10, requestRetries: 8, downloadRetries: 8, retryDelay: 1000, autoReconnect: true, maxConcurrentDownloads: 2, useWSS: false }
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
      if (
        !acc ||
        acc.status !== "connected" ||
        !acc.sessionCipher ||
        !acc.sessionIV ||
        !acc.sessionAuthTag
      ) {
        logger.info("TelegramService: no active stored connection, waiting for connect");
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
        { connectionRetries: 10, reconnectRetries: 10, requestRetries: 8, downloadRetries: 8, retryDelay: 1000, autoReconnect: true, maxConcurrentDownloads: 2, useWSS: false }
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
    // The fresh OTP client now owns the service lifecycle. Keep the boot
    // promise resolved so status/health requests cannot start a second
    // TelegramClient and overwrite this authenticated flow.
    this.bootPromise = Promise.resolve();
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

    // Disconnect is reversible. Keep the encrypted Telegram session so the
    // same account can reconnect without destroying its authentication state.
    // File/folder/channel records are never touched here.
    await db.telegramAccount.updateMany({
      data: {
        status: "disconnected",
        lastError: null,
      },
    });
    logger.info("TelegramService: disconnected; encrypted session preserved");
  }

  /**
   * Resolve a stored channel id (e.g. "-1001234567890", kept as a string)
   * to an input entity. Wraps GramJS errors with an actionable message —
   * callers surface `detail` to the dashboard instead of a bare 500/502.
   */
  private async resolvePeer(peerId: string) {
    if (!this.client) throw new Error(this.notConnectedMessage());

    const normalizedPeerId = peerId.trim();
    if (!normalizedPeerId) throw new Error("Telegram channel ID is required");

    try {
      return await this.client.getInputEntity(normalizedPeerId);
    } catch (firstErr) {
      try {
        const dialogs = await this.client.getDialogs({ limit: 1000 });
        const channelId = normalizedPeerId.match(/^-100(\d+)$/)?.[1];
        const dialog = dialogs.find((d) => {
          const entity = d.entity;
          return Boolean(channelId && entity instanceof Api.Channel && entity.id.toString() === channelId);
        });
        if (dialog?.entity) return await this.client.getInputEntity(dialog.entity);
      } catch {}
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      throw new Error(`Could not resolve Telegram channel ${normalizedPeerId}: ${msg}. The connected Telegram account must be a member/admin of the channel, and the channel must be visible in its dialogs. Ensure the ID is correct and reconnect the account if needed.`);
    }
  }
  /** Build a channel input peer directly from the access hash stored with the file.
   * This avoids relying on GramJS's entity cache/dialogs for old files.
   */
  private inputPeerFromStoredChannel(peerId: string, accessHash: string) {
    const match = peerId.trim().match(/^-100(\d+)$/);
    if (!match || !accessHash.trim()) throw new Error(`Invalid stored Telegram channel reference: ${peerId}`);
    return new Api.InputPeerChannel({
      channelId: bigInt(match[1]),
      accessHash: bigInt(accessHash.trim()),
    });
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
    onProgress?: (progress: number) => void,
    uploadId?: string
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
          progressCallback: (progress) => {
            onProgress?.(progress);
            if (uploadId) setTelegramUploadProgress(uploadId, Math.round(progress * 100), "telegram");
          },

          caption: originalName,
          forceDocument: true,
          fileSize: buf.length,
        });
          if (uploadId) setTelegramUploadProgress(uploadId, 100, "complete");
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
   * Upload an already assembled file from disk without buffering the whole file in RAM.
   * Used by resumable HTTP uploads so the Railway request can finish before Telegram transfer.
   */
  async uploadFileFromPath(
    peerId: string,
    filePath: string,
    fileSize: number,
    originalName: string,
    onProgress?: (progress: number) => void,
    uploadId?: string
  ): Promise<{
    messageId: number;
    fileId: string;
    accessHash: string;
    fileReference: string;
  }> {
    await this.ensureConnectedClient();
    if (!this.client) throw new Error(this.notConnectedMessage());
    const peer = await this.resolvePeer(peerId);
    const telegramFile = new CustomFile(originalName, fileSize, filePath);
    const isVideo = /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(originalName);
    // Let Telegram classify supported video uploads as videos so it can create
    // a native document thumbnail and mark MP4/MOV media as streamable.
    // Existing non-video files remain documents exactly as before.
    // Keep parallel MTProto part uploads conservative for large videos. Eight
    // concurrent parts can amplify transient socket/RPC failures on 300–800 MiB
    // transfers; allow explicit tuning but cap large files at four workers.
    const largeVideo = isVideo && fileSize >= 300 * 1024 * 1024;
    const defaultWorkers = largeVideo ? 2 : 4;
    const configuredWorkers = Number.parseInt(process.env.TELEGRAM_UPLOAD_WORKERS ?? String(defaultWorkers), 10);
    const workers = Number.isFinite(configuredWorkers)
      ? Math.max(1, Math.min(largeVideo ? 4 : 8, configuredWorkers))
      : defaultWorkers;
    const uploadStartedAt = Date.now();
    let lastLoggedProgress = -10;
    logger.info(isVideo ? "video_upload_started" : "telegram_upload_started", {
      uploadId,
      sizeBytes: fileSize,
      workers,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const sent = await this.client.sendFile(peer, {
          file: telegramFile,
          progressCallback: (progress) => {
            onProgress?.(progress);
            const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 100)));
            if (uploadId) setTelegramUploadProgress(uploadId, progressPercent, "telegram");
            if (progressPercent >= 100 || progressPercent - lastLoggedProgress >= 10) {
              lastLoggedProgress = progressPercent;
              logger.info(isVideo ? "video_upload_progress" : "telegram_upload_progress", {
                uploadId,
                sizeBytes: fileSize,
                bytesTransferred: Math.round(fileSize * progressPercent / 100),
                progressPercent,
                elapsedMs: Date.now() - uploadStartedAt,
                workers,
              });
            }
          },
          caption: originalName,
          forceDocument: !isVideo,
          supportsStreaming: isVideo,
          fileSize,
          workers,
        });
        logger.info(isVideo ? "video_upload_completed" : "telegram_upload_completed", {
          uploadId,
          sizeBytes: fileSize,
          durationMs: Date.now() - uploadStartedAt,
          workers,
        });
        return this.extractMessageRef(sent);
      } catch (err) {
        logger.warn(isVideo ? "video_upload_attempt_failed" : "telegram_upload_attempt_failed", {
          uploadId,
          sizeBytes: fileSize,
          attempt: attempt + 1,
          elapsedMs: Date.now() - uploadStartedAt,
          reason: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        });
        const waitSeconds = this.getFloodWaitSeconds(err);
        if (waitSeconds != null && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
          continue;
        }
        if (attempt === 0 && this.client && !this.client.connected) {
          await this.ensureConnectedClient(true);
          continue;
        }
        throw err;
      }
    }
    throw new Error("Telegram upload failed after retries");
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
    currentFileReferenceB64: string,
    accessHash?: string
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
   * Download a Telegram document directly to a temporary/server-side path.
   * This is used by RAW preview generation so an 800 MB original is never
   * materialized as one giant Node Buffer.
   */
  async downloadFileToPath(
    peerId: string,
    messageId: number,
    currentFileReferenceB64: string,
    outputPath: string,
    accessHash?: string
  ): Promise<{ refreshedReferenceB64?: string }> {
    await this.start();
    if (this.status !== "connected" || !this.client) {
      throw new Error(this.notConnectedMessage());
    }
    const peer = await this.resolvePeer(peerId);
    const msgs = await this.client.getMessages(peer, { ids: [messageId], limit: 1 });
    const fresh = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!fresh) throw new Error("Message not found");
    const media = fresh.media as
      | (Api.MessageMediaDocument & { document?: Api.Document & { fileReference: Buffer } })
      | undefined;
    const doc = media?.document;
    if (!doc) throw new Error("Message has no media document");
    const newRef = doc.fileReference.toString("base64");
    const refreshed = newRef !== currentFileReferenceB64;
    const location = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });

    // Stream the original to disk in bounded chunks. downloadMedia() can hold
    // a long-lived request open and is prone to connection-level timeouts on
    // large Telegram documents. iterDownload gives us retryable chunk boundaries
    // and keeps memory bounded.
    const requestSize = 512 * 1024;
    const maxAttempts = 3;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const handle = await fs.open(outputPath, "w");
        try {
          let received = 0;
          for await (const chunk of this.client.iterDownload({
            file: location,
            offset: bigInt(0),
            requestSize,
            fileSize: doc.size,
          })) {
            const bytes = Buffer.from(chunk);
            await handle.write(bytes);
            received += bytes.length;
            if (received % (8 * 1024 * 1024) < bytes.length) {
              logger.info("[DNG_SOURCE] download progress", {
                messageId,
                attempt,
                receivedBytes: received,
              });
            }
          }
          if (received <= 0) throw new Error("download returned empty");
          return { refreshedReferenceB64: refreshed ? newRef : undefined };
        } finally {
          await handle.close();
        }
      } catch (error) {
        lastError = error;
        logger.warn("[DNG_SOURCE] chunked download retry", {
          messageId,
          attempt,
          reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("RAW_SOURCE_DOWNLOAD_FAILED");
  }

  /**
   * Build a Telegram document location directly from the metadata already
   * persisted on File. This avoids getMessages() on every browser Range.
   */
  private buildDocumentLocation(fileId: string, accessHash: string, fileReferenceB64: string) {
    return new Api.InputDocumentFileLocation({
      id: bigInt(fileId),
      accessHash: bigInt(accessHash),
      fileReference: Buffer.from(fileReferenceB64, "base64"),
      thumbSize: "",
    });
  }

  /** Refresh a stale Telegram file reference only when Telegram rejects it. */
  private async refreshDocumentReference(peerId: string, messageId: number) {
    const peer = await this.resolvePeer(peerId);
    const msgs = await this.client!.getMessages(peer, { ids: [messageId], limit: 1 });
    const fresh = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!fresh) throw new Error("Message not found");
    const media = fresh.media as (Api.MessageMediaDocument & {
      document?: Api.Document & {
        id: { toString(): string };
        accessHash: { toString(): string };
        fileReference: Buffer;
        thumbs?: Api.TypePhotoSize[];
      };
    }) | undefined;
    const doc = media?.document;
    if (!doc) throw new Error("Message has no media document");
    return {
      message: fresh,
      fileId: doc.id.toString(),
      accessHash: doc.accessHash.toString(),
      fileReference: doc.fileReference.toString("base64"),
      doc,
    };
  }

  /**
   * Try Telegram's own generated document thumbnail first. Telegram can serve
   * this without downloading the original video, making it the fast path.
   */
  async downloadVideoThumbnail(peerId: string, messageId: number): Promise<Buffer | undefined> {
    await this.start();
    if (this.status !== "connected" || !this.client) throw new Error(this.notConnectedMessage());
    const fresh = await this.refreshDocumentReference(peerId, messageId);
    const thumbs = fresh.doc.thumbs ?? [];
    if (!thumbs.length) return undefined;
    const largest = thumbs[thumbs.length - 1];
    const bytes = await this.client.downloadMedia(fresh.message, { thumb: largest }) as Buffer | undefined;
    return bytes && bytes.length > 0 ? bytes : undefined;
  }

  /**
   * Download only a bounded prefix for thumbnail extraction. This is a fallback
   * when Telegram has no usable generated thumbnail. The caller can then try
   * FFmpeg without materializing the full source video in Node memory.
   */
  async downloadFilePrefixToPath(
    peerId: string,
    messageId: number,
    fileId: string,
    accessHash: string,
    currentFileReferenceB64: string,
    outputPath: string,
    maxBytes = 8 * 1024 * 1024,
  ): Promise<{ bytes: number; refreshedReferenceB64?: string }> {
    await this.start();
    if (this.status !== "connected" || !this.client) throw new Error(this.notConnectedMessage());
    const requestSize = 512 * 1024;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const location = this.buildDocumentLocation(fileId, accessHash, currentFileReferenceB64);
        const handle = await fs.open(outputPath, "w");
        try {
          let received = 0;
          for await (const chunk of this.client.iterDownload({
            file: location,
            offset: bigInt(0),
            limit: Math.ceil(maxBytes / requestSize),
            requestSize,
            fileSize: bigInt(maxBytes),
          })) {
            const bytes = Buffer.from(chunk);
            const take = Math.min(bytes.length, maxBytes - received);
            if (take <= 0) break;
            await handle.write(bytes.subarray(0, take));
            received += take;
            if (received >= maxBytes) break;
          }
          return { bytes: received };
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (attempt === 1) {
          const fresh = await this.refreshDocumentReference(peerId, messageId);
          currentFileReferenceB64 = fresh.fileReference;
          fileId = fresh.fileId;
          accessHash = fresh.accessHash;
          continue;
        }
        throw error;
      }
    }
    throw new Error("VIDEO_PREFIX_DOWNLOAD_FAILED");
  }

  /**
   * Download only a byte range from a Telegram document. Uses persisted
   * document metadata directly; getMessages() is only used after a stale
   * file-reference error.
   */
  async downloadFileRange(
    peerId: string,
    messageId: number,
    fileId: string,
    currentFileReferenceB64: string,
    start: number,
    end: number,
    accessHash?: string,
    requestId?: string
  ): Promise<{ bytes: Buffer; refreshedReferenceB64?: string }> {
    await this.start();
    if (this.status !== "connected" || !this.client) {
      throw new Error(this.notConnectedMessage());
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error("INVALID_RANGE");
    }

    const rangeStartedAt = Date.now();
    const rangeRequestId = requestId ?? randomBytes(8).toString("hex");
    let rangeChunkCount = 0;
    let rangeRetryCount = 0;
    let referenceRefreshMs = 0;
    const requestSize = 512 * 1024;
    const rangeLength = end - start + 1;
    let lastError: unknown = null;
    let activeFileId = fileId;
    let activeAccessHash = accessHash ?? "";
    let activeReference = currentFileReferenceB64;

    // Browser Range requests should use persisted Telegram document metadata
    // directly. getMessages() is a slow control-plane operation and is only
    // needed when Telegram rejects an expired file reference.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        if (!this.client || this.status !== "connected") await this.ensureConnectedClient(true);
        if (!this.client) throw new Error(this.notConnectedMessage());
        if (!activeAccessHash) throw new Error("TELEGRAM_ACCESS_HASH_MISSING");

        const location = this.buildDocumentLocation(activeFileId, activeAccessHash, activeReference);
        // Align each Telegram request to its 512 KiB boundary. This lets us
        // fetch independent chunks concurrently without GenericDownloadIter
        // re-fetching overlapping chunks to satisfy an unaligned offset.
        const alignedStart = Math.floor(start / requestSize) * requestSize;
        const leadingBytes = start - alignedStart;
        const bytesToFetch = leadingBytes + rangeLength;
        const chunkCount = Math.ceil(bytesToFetch / requestSize);
        const chunks = new Array<Buffer>(chunkCount);
        let nextChunkIndex = 0;
        let chunkError: unknown = null;
        const workerCount = Math.min(8, chunkCount);

        // Telegram's iterDownload yields sequentially. Fetch a small bounded
        // group of independent aligned chunks concurrently so high-bitrate
        // video ranges can arrive faster than the browser consumes its buffer.
        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (chunkError === null) {
            const chunkIndex = nextChunkIndex++;
            if (chunkIndex >= chunkCount) return;

            const chunkOffset = alignedStart + chunkIndex * requestSize;
            const expectedLength = Math.min(requestSize, bytesToFetch - chunkIndex * requestSize);
            try {
              const iterator = this.client!.iterDownload({
                file: location,
                offset: bigInt(chunkOffset),
                limit: 1,
                chunkSize: requestSize,
                requestSize,
              });
              let fetched: Buffer | null = null;
              for await (const chunk of iterator) {
                fetched = Buffer.from(chunk);
                break;
              }
              rangeChunkCount += 1;
              if (!fetched || fetched.length < expectedLength) {
                throw new Error(`RANGE_INCOMPLETE_CHUNK:${chunkIndex}:${fetched?.length ?? 0}/${expectedLength}`);
              }
              chunks[chunkIndex] = fetched.subarray(0, expectedLength);
            } catch (error) {
              chunkError ??= error;
              return;
            }
          }
        }));

        if (chunkError !== null) throw chunkError;
        const fetchedBytes = Buffer.concat(chunks, bytesToFetch);
        const bytes = fetchedBytes.subarray(leadingBytes, leadingBytes + rangeLength);
        if (bytes.length !== rangeLength) throw new Error(`RANGE_INCOMPLETE:${bytes.length}/${rangeLength}`);

        if (requestId) logger.info("Telegram range fetch complete", { requestId: rangeRequestId, telegramRangeMs: Date.now() - rangeStartedAt, telegramRpcAndRetryMs: Math.max(0, Date.now() - rangeStartedAt - referenceRefreshMs), rangeBytes: rangeLength, chunkCount: rangeChunkCount, retryCount: rangeRetryCount, referenceRefreshMs, telegramStatus: this.status });
        return {
          bytes,
          refreshedReferenceB64: activeReference !== currentFileReferenceB64 ? activeReference : undefined,
        };
      } catch (error) {
        lastError = error;
        rangeRetryCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Telegram range download retry", { requestId: rangeRequestId, messageId, start, end, attempt, attemptMs: Date.now() - attemptStartedAt, telegramStatus: this.status, reason: message.slice(0, 300) });
        if (attempt < 3) {
          if (/FILE_REFERENCE|FILE_REFERENCE_EXPIRED|FILEREF|TELEGRAM_ACCESS_HASH_MISSING|TELEGRAM_FILE_ID_MISSING|RPC_CALL_FAIL|TIMEOUT|CONNECTION|AUTH_KEY/i.test(message)) {
            try {
              const refreshStartedAt = Date.now();
              const fresh = await this.refreshDocumentReference(peerId, messageId);
              referenceRefreshMs += Date.now() - refreshStartedAt;
              activeFileId = fresh.fileId;
              activeAccessHash = fresh.accessHash;
              activeReference = fresh.fileReference;
            } catch {}
          }
          if (!this.client?.connected || /TIMEOUT|CONNECTION|AUTH_KEY/i.test(message)) {
            try { await this.ensureConnectedClient(true); } catch {}
          }
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("VIDEO_RANGE_DOWNLOAD_FAILED");
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

    // The OTP flow intentionally keeps a resolved bootPromise after login.
    // If that long-lived GramJS client drops its socket later, bootPromise
    // must not prevent us from reconnecting the existing client.
    if (!forceReconnect && this.client && this.status === "connected") {
      if (this.client.connected) return;

      try {
        await this.client.connect();
        if (this.client.connected && await this.client.checkAuthorization()) {
          this.lastError = null;
          return;
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.warn("TelegramService: existing client reconnect failed", {
          err: this.lastError,
        });
      }

      try { await this.client.disconnect(); } catch {}
      this.client = null;
      this.status = "disconnected";
      this.bootPromise = null;
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
      { connectionRetries: 10, reconnectRetries: 10, requestRetries: 8, downloadRetries: 8, retryDelay: 1000, autoReconnect: true, maxConcurrentDownloads: 2, useWSS: false }
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
  globalForTelegram.__telegramService ?? (globalForTelegram.__telegramService = new TelegramServiceImpl());
