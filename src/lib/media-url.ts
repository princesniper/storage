/**
 * Canonical sequential media URLs use MEDIA_PUBLIC_URL, for example
 * https://growplants-media.up.railway.app/images/000042.jpg.
 * Sequence numbers are allocated server-side and never reused.
 * The six-digit display width grows naturally for larger sequence values.
 * Extensions are derived from the stored MIME type.
 *
 * MEDIA_PUBLIC_URL is the source of truth. In production it must be a valid
 * HTTPS URL; no request host, browser origin, APP_URL, or localhost fallback
 * is allowed. Local development uses http://localhost:3000 when unset.
 */

/**
 * Environment-specific fallback: production uses the approved public media
 * domain; local development uses localhost. Production validation still
 * requires MEDIA_PUBLIC_URL to be explicitly configured.
 */
const DEFAULT_MEDIA_ORIGIN = process.env.NODE_ENV === "production"
  ? "https://growplants-media.up.railway.app"
  : "http://localhost:3000";

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
  // A developer's .env can be loaded during production builds and contain a
  // localhost origin. Never let that value leak into a production build.
  // Railway injects the real MEDIA_PUBLIC_URL into the running service.
  if (
    process.env.NEXT_PHASE === "phase-production-build" &&
    (!raw || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(raw))
  ) {
    return "https://growplants-media.up.railway.app";
  }
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MEDIA_PUBLIC_URL is required in production. Set it to the public application origin, e.g. https://growplants-media.up.railway.app; refusing to generate public media URLs with a local or implicit origin.");
    }
    return DEFAULT_MEDIA_ORIGIN;
  }
  const normalized = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `Invalid MEDIA_PUBLIC_URL=${JSON.stringify(raw)} — must be a full public HTTPS URL like https://growplants-media.up.railway.app`
    );
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("MEDIA_PUBLIC_URL must use HTTPS in production.");
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
  "image/x-raw-canon-cr2": "cr2",
  "image/x-raw-canon-cr3": "cr3",
  "image/x-raw-nikon": "nef",
  "image/x-raw-sony": "arw",
  "image/x-adobe-dng": "dng",
  "image/x-raw-fuji": "raf",
  "image/x-raw-panasonic": "rw2",
  "image/x-raw-olympus": "orf",
  "image/x-raw-pentax": "pef",
  "image/x-raw-samsung": "srw",
  "image/x-raw-sigma": "x3f",
  "image/x-raw-phaseone": "iiq",
  "image/x-raw-hasselblad": "3fr",
  "image/x-raw-leaf": "mos",
  "image/x-raw-mamiya": "mef",
  "image/x-raw-minolta": "mrw",
  "image/x-raw-epson": "erf",
  "image/x-raw-kodak": "dcr",
  "image/x-raw": "raw",
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
  // Stored/browser MIME values may include parameters, e.g. "audio/ogg; codecs=opus".
  // Extension resolution must use only the MIME essence so the canonical URL stays .ogg.
  const essence = mimeType.split(";", 1)[0].trim().toLowerCase();
  const known = MIME_TO_EXT[essence];
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
