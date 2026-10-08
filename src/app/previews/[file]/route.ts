import { NextResponse } from "next/server";
import { cache } from "@/lib/cache";
import { db } from "@/lib/db";
import { formatSequence, parseMediaFilename } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";

interface RouteContext { params: Promise<{ file: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const { file } = await ctx.params;
  const parsed = parseMediaFilename(file);
  if (!parsed || parsed.ext !== "jpg") {
    return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const row = await db.file.findUnique({
    where: { sequenceNumber: parsed.sequenceNumber },
    select: {
      id: true,
      status: true,
      mimeType: true,
      previewStatus: true,
      previewSize: true,
      previewTelegramMessageId: true,
      previewTelegramFileReference: true,
      previewTelegramAccessHash: true,
      previewUrl: true,
      storageChannel: { select: { telegramChannelId: true } },
    },
  });

  if (!row || row.status !== "active" || !row.mimeType.startsWith("image/x-") || row.previewStatus !== "ready" ||
      !row.previewTelegramMessageId || !row.previewTelegramFileReference || !row.previewUrl) {
    return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const key = `preview:${formatSequence(parsed.sequenceNumber)}`;
  const cached = await cache.getBytes(key);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(cached.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  await telegramService.ensureStarted();
  if (telegramService.getStatus() !== "connected") {
    return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502, headers: { "Retry-After": "30" } });
  }

  try {
    const result = await telegramService.downloadFile(
      row.storageChannel.telegramChannelId,
      row.previewTelegramMessageId,
      row.previewTelegramFileReference,
      row.previewTelegramAccessHash ?? undefined,
    );
    if (!result.bytes.length) throw new Error("EMPTY_PREVIEW");
    await cache.setBytes(key, result.bytes);
    if (result.refreshedReferenceB64) {
      await db.file.update({ where: { id: row.id }, data: { previewTelegramFileReference: result.refreshedReferenceB64 } }).catch(() => {});
    }
    return new Response(result.bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(result.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502, headers: { "Retry-After": "30" } });
  }
}
