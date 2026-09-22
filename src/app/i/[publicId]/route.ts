/**
 * GET /i/:publicId — LEGACY endpoint (pre-sequential-URL scheme).
 *
 * Old embeds (https://…/i/gp_x82ka91) keep working via a 301 redirect to
 * the canonical sequential URL (https://m.media-growplants.com/images/000042.jpg).
 * The redirect target is ALWAYS the fixed canonical origin, regardless of
 * which host serves this route. Status semantics are preserved:
 * unknown ids → 404, deleted files → 410.
 *
 * This route performs one indexed DB lookup and redirects; all byte
 * serving, caching and Telegram logic lives in /images/[file].
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CANONICAL_MEDIA_ORIGIN, mediaPath } from "@/lib/media-url";
import { NEGATIVE_TTL } from "@/lib/serve-media";

interface RouteContext { params: Promise<{ publicId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { publicId } = await ctx.params;

  const file = await db.file.findUnique({
    where: { publicId },
    select: { sequenceNumber: true, mimeType: true, status: true },
  });

  if (!file || file.sequenceNumber == null) {
    return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${NEGATIVE_TTL}`,
      },
    });
  }
  if (file.status !== "active") {
    return new Response(JSON.stringify({ error: "GONE" }), {
      status: 410,
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${NEGATIVE_TTL}` },
    });
  }

  // Redirect target is the fixed canonical origin (never the request host).
  return NextResponse.redirect(
    `${CANONICAL_MEDIA_ORIGIN}${mediaPath(file.sequenceNumber, file.mimeType)}`,
    301
  );
}
