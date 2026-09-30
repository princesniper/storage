/**
 * GET /images/000042.jpg
 *
 * Canonical public file endpoint (images + video). No auth required.
 * CDN-friendly. Streams from the Telegram-backed storage layer —
 * never exposes raw Telegram URLs.
 *
 * - Numeric prefix (leading zeros ignored) maps to File.sequenceNumber.
 * - Extension must match the stored type; mismatches 301-redirect to
 *   the canonical URL (single canonical URL per file).
 * - Deleted files → 410 GONE (number stays permanently consumed).
 * - Unknown numbers → 404.
 */
import { NextResponse } from "next/server";
import { cache } from "@/lib/cache";
import { canonicalUrl, extForMime, parseMediaFilename } from "@/lib/media-url";
import {
  NEGATIVE_TTL,
  cacheKeyFor,
  loadFileBySequence,
  notFound,
  respondWithFileBytes,
} from "@/lib/serve-media";

interface RouteContext { params: Promise<{ file: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { file } = await ctx.params;
  const parsed = parseMediaFilename(file);
  if (!parsed) return notFound();

  const dbFile = await loadFileBySequence(parsed.sequenceNumber);
  if (!dbFile) {
    await cache.setExists(cacheKeyFor(parsed.sequenceNumber), false);
    return notFound();
  }
  if (dbFile.status !== "active") {
    // Soft-deleted (or missing): URL is dead, number stays consumed.
    return new Response(JSON.stringify({ error: "GONE" }), {
      status: 410,
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${NEGATIVE_TTL}` },
    });
  }

  // Canonical extension enforcement (301, same host — works on any domain).
  const canonicalExt = extForMime(dbFile.mimeType);
  if (parsed.ext !== canonicalExt) {
    // Redirect to the configured canonical public origin, never the incoming
    // Railway/internal request host (for example 0.0.0.0:8080).
    return NextResponse.redirect(canonicalUrl(dbFile.sequenceNumber, dbFile.mimeType), 301);
  }

  return respondWithFileBytes(dbFile, req);
}
