/**
 * Canonical sequential media URLs: https://m.media-growplants.com/images/000001.jpg
 *
 * - Sequence numbers are allocated server-side from MediaSequence
 *   (atomic auto-increment, never reused) — never trusted from clients.
 * - Zero-padded display width is 6 (000001…). If the counter ever exceeds
 *   999999, output gracefully grows (1000000) — no crash, no collision.
 * - Extension is derived server-side from the stored MIME type.
 *
 * ORIGIN POLICY (critical):
 * The canonical public origin comes from MEDIA_PUBLIC_URL (normalized,
 * trailing slash stripped), defaulting to https://m.media-growplants.com
 * when unset. It is NEVER derived from the request URL, request host,
 * window.location, localhost, deployment hostname, or APP_URL.
 * Local dev still SERVES /images/[file] on localhost for route testing —
 * but every stored/shown/copied PUBLIC url always uses CANONICAL_MEDIA_ORIGIN.
 */

/**
 * Fixed default canonical media origin. Used when MEDIA_PUBLIC_URL is not
 * set. Same value in dev, staging and production unless the env override
 * below is configured (with a data migration, since stored URLs embed it).
 */
const DEFAULT_MEDIA_ORIGIN = "https://m.media-growplants.com";

/**
 * Resolve the canonical public media origin.
 *
 * - Primary source: MEDIA_PUBLIC_URL env var (trailing slashes stripped,
 *   so "...com/" never produces "...com//images/...").
 * - Fallback: DEFAULT_MEDIA_ORIGIN above.
 * - NEVER derived from the request URL/host, window.location, localhost,
 *   APP_URL, or any deployment hostname.
 * - An invalid (non-URL) MEDIA_PUBLIC_URL throws at boot — a loud
 *   server-side configuration error instead of silently serving localhost
 *   or malformed public URLs.
 */
function resolveMediaOrigin(): string {
  const raw = (process.env.MEDIA_PUBLIC_URL ?? "").trim();
  if (!raw) return DEFAULT_MEDIA_ORIGIN;
  const normalized = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `Invalid MEDIA_PUBLIC_URL=${JSON.stringify(raw)} — must be a full URL like https://m.media-growplants.com`
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Invalid MEDIA_PUBLIC_URL=${JSON.stringify(raw)} — must use http(s) protocol`
    );
  }
  return normalized;
}

export const CANONICAL_MEDIA_ORIGIN = resolveMediaOrigin();

/** Fixed display width for zero-padding (approved: 6 digits). */
export const SEQUENCE_PAD_WIDTH = 6;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/oga": "oga",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
};

/** image/jpeg → "jpg" (fallback: subtype after the slash). */
export function extForMime(mimeType: string): string {
  const known = MIME_TO_EXT[mimeType];
  if (known) return known;
  const sub = mimeType.split("/")[1] ?? "bin";
  return sub.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
}

/** 42 → "000042" (width grows past 999999 instead of breaking). */
export function formatSequence(n: number): string {
  return String(Math.trunc(n)).padStart(SEQUENCE_PAD_WIDTH, "0");
}

/** "/images/000042.jpg" path for a sequence number + mime type. */
export function mediaPath(sequenceNumber: number, mimeType: string): string {
  return `/images/${formatSequence(sequenceNumber)}.${extForMime(mimeType)}`;
}

/** Full canonical public URL, e.g. https://m.media-growplants.com/images/000042.jpg
 *  Environment-independent: identical output no matter where the app runs. */
export function canonicalUrl(sequenceNumber: number, mimeType: string): string {
  return `${CANONICAL_MEDIA_ORIGIN}${mediaPath(sequenceNumber, mimeType)}`;
}

/**
 * Parse an /images/ filename ("000042.jpg") → { sequenceNumber, ext }.
 * Returns null for malformed input. Leading zeros are ignored numerically.
 */
export function parseMediaFilename(file: string): { sequenceNumber: number; ext: string } | null {
  const m = /^(\d{1,12})\.([a-z0-9]{2,5})$/i.exec(file.trim());
  if (!m) return null;
  const sequenceNumber = Number(m[1]);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber <= 0) return null;
  return { sequenceNumber, ext: m[2].toLowerCase() };
}
