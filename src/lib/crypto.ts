/**
 * AES-256-GCM encryption helpers for the Telegram StringSession.
 * The session grants full account control — must be encrypted at rest.
 *
 * Key format: 32 bytes (64 hex chars) from env TELEGRAM_SESSION_KEY.
 * IV: 12 random bytes per encryption (stored alongside ciphertext).
 * Auth tag: 16 bytes (stored alongside ciphertext).
 *
 * Lazy validation: SESSION_KEY_RAW is read at import time but only validated
 * when encrypt/decrypt is called. This lets the app boot without Telegram
 * credentials configured.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const raw = process.env.TELEGRAM_SESSION_KEY;
  if (!raw || raw.length !== 64) {
    throw new Error("TELEGRAM_SESSION_KEY must be 64 hex chars (32 bytes). Set it in .env before connecting Telegram.");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("TELEGRAM_SESSION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export interface EncryptedSession {
  cipherB64: string; // base64 ciphertext
  ivB64: string;     // base64 12-byte nonce
  authTagB64: string; // base64 16-byte GCM tag
}

export function encryptSession(sessionString: string): EncryptedSession {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(sessionString, "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    cipherB64: enc.toString("base64"),
    ivB64: iv.toString("base64"),
    authTagB64: authTag.toString("base64"),
  };
}

export function decryptSession(rec: EncryptedSession): string {
  const key = getKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(rec.ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(rec.authTagB64, "base64"));
  const enc = Buffer.from(rec.cipherB64, "base64");
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
