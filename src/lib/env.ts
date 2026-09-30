/**
 * Centralized environment configuration.
 * All secrets come from here — never import process.env directly elsewhere.
 *
 * Validation strategy:
 * - Core app secrets (DATABASE_URL, AUTH_SECRET) are mandatory.
 * - Telegram credentials are optional — the app boots even without them;
 *   TelegramService simply reports "disconnected" and the dashboard shows a warning.
 * - Telegram credentials are validated at the time of use (requestCode, etc.).
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 chars"),
  // Telegram creds: optional in dev, validated when used
  TELEGRAM_API_ID: z.string().optional().transform((v) => (v ? Number(v) : 0)),
  TELEGRAM_API_HASH: z.string().optional().default(""),
  TELEGRAM_SESSION_KEY: z.string().optional().default(""),
  MAX_IMAGE_SIZE_MB: z.string().optional().transform((v) => (v ? Number(v) : 20)),
  // V2: canonical file size limit (images). Defaults to 50; legacy MAX_IMAGE_SIZE_MB
  // acts as an alias when MAX_FILE_SIZE_MB is unset.
  MAX_FILE_SIZE_MB: z.string().optional(),
  MAX_VIDEO_SIZE_MB: z.string().optional().transform((v) => (v ? Number(v) : 1024)),
  ALLOWED_MIME_TYPES: z.string().default(
    [
      "image/jpeg","image/png","image/webp","image/gif","image/svg+xml",
      "video/mp4","video/webm","video/quicktime",
      "audio/mpeg","audio/wav","audio/x-wav","audio/ogg","audio/oga","audio/mp4","audio/aac","audio/webm","audio/flac","audio/x-flac","audio/m4a","audio/x-m4a",
      "application/pdf","application/zip","application/x-zip-compressed",
      "application/json","application/xml","application/javascript",
      "application/octet-stream","application/vnd.ms-fontobject",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/msword","application/vnd.ms-excel","application/vnd.ms-powerpoint",
      "font/ttf","font/otf","font/woff","font/woff2",
      "text/plain","text/css","text/html","text/csv","text/xml","text/markdown",
      "text/javascript","application/typescript"
    ].join(",")
  ),
  // V2-Feature-6: optional Redis. Empty = in-memory LRU only.
  REDIS_URL: z.string().optional().default(""),
  CACHE_TTL_SECONDS: z.string().optional().transform((v) => (v ? Number(v) : 604800)),
  CACHE_MAX_ITEMS: z.string().optional().transform((v) => (v ? Number(v) : 500)),
  RATE_LIMIT_PUBLIC_PER_MIN: z.string().optional().transform((v) => (v ? Number(v) : 600)),
  RATE_LIMIT_LOGIN_PER_15MIN: z.string().optional().transform((v) => (v ? Number(v) : 5)),
  RATE_LIMIT_UPLOAD_PER_MIN: z.string().optional().transform((v) => (v ? Number(v) : 30)),
  MAX_BULK_UPLOAD_FILES: z.string().optional().transform((v) => (v ? Number(v) : 10)),
  // Canonical public media origin (e.g. https://m.media-growplants.com).
  // Unset = built-in default in src/lib/media-url.ts. Never localhost.
  MEDIA_PUBLIC_URL: z.string().optional().default(""),
});

function loadEnv() {
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    APP_URL: process.env.APP_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    TELEGRAM_API_ID: process.env.TELEGRAM_API_ID,
    TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH,
    TELEGRAM_SESSION_KEY: process.env.TELEGRAM_SESSION_KEY,
    MAX_IMAGE_SIZE_MB: process.env.MAX_IMAGE_SIZE_MB,
    MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB,
    MAX_VIDEO_SIZE_MB: process.env.MAX_VIDEO_SIZE_MB,
    ALLOWED_MIME_TYPES: process.env.ALLOWED_MIME_TYPES,
    REDIS_URL: process.env.REDIS_URL,
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
    CACHE_MAX_ITEMS: process.env.CACHE_MAX_ITEMS,
    RATE_LIMIT_PUBLIC_PER_MIN: process.env.RATE_LIMIT_PUBLIC_PER_MIN,
    RATE_LIMIT_LOGIN_PER_15MIN: process.env.RATE_LIMIT_LOGIN_PER_15MIN,
    RATE_LIMIT_UPLOAD_PER_MIN: process.env.RATE_LIMIT_UPLOAD_PER_MIN,
    MAX_BULK_UPLOAD_FILES: process.env.MAX_BULK_UPLOAD_FILES,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
  });
  if (!parsed.success) {
    console.error("Invalid environment configuration. Missing or invalid keys:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    throw new Error(
      `Environment validation failed: ${parsed.error.issues
        .map((i) => i.path.join("."))
        .join(", ")}`
    );
  }
  return parsed.data;
}

export const env = loadEnv();

export const allowedMimeTypes = env.ALLOWED_MIME_TYPES
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function normalizeMimeType(mime: string): string {
  return mime.trim().toLowerCase().split(";")[0] ?? "";
}

export function isAudioMime(mime: string): boolean {
  return normalizeMimeType(mime).startsWith("audio/");
}

export function isAllowedDetectedMime(mime: string): boolean {
  const normalized = normalizeMimeType(mime);
  return allowedMimeTypes.includes(normalized) || isAudioMime(normalized);
}
// V2: MAX_FILE_SIZE_MB is canonical (default 50). Legacy MAX_IMAGE_SIZE_MB
// still works as a fallback alias when MAX_FILE_SIZE_MB is unset.
function resolveMaxFileMb(): number {
  if (process.env.MAX_FILE_SIZE_MB && Number(process.env.MAX_FILE_SIZE_MB) > 0) {
    return Number(process.env.MAX_FILE_SIZE_MB);
  }
  if (process.env.MAX_IMAGE_SIZE_MB && Number(process.env.MAX_IMAGE_SIZE_MB) > 0) {
    return Number(process.env.MAX_IMAGE_SIZE_MB);
  }
  return 50;
}
export const maxFileSizeBytes = resolveMaxFileMb() * 1024 * 1024;
/** Backward-compat alias (V1 name). */
export const maxImageSizeBytes = maxFileSizeBytes;
export const maxVideoSizeBytes = env.MAX_VIDEO_SIZE_MB * 1024 * 1024;
export const maxBulkUploadFiles = env.MAX_BULK_UPLOAD_FILES;

export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

export const telegramConfigured = Boolean(
  env.TELEGRAM_API_ID &&
    env.TELEGRAM_API_ID > 0 &&
    env.TELEGRAM_API_HASH &&
    env.TELEGRAM_API_HASH.length >= 10
);

export const sessionKeyConfigured = Boolean(
  env.TELEGRAM_SESSION_KEY && env.TELEGRAM_SESSION_KEY.length === 64
);
