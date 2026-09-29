import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { canonicalUrl } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";
import { tryCreateVideoThumbnail } from "@/services/video-thumbnail";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const rawId = (await ctx.params).id;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const file = await db.file.findUnique({
    where: { id },
    select: {
      id: true,
      mimeType: true,
      sequenceNumber: true,
      thumbnailPublicId: true,
      telegramMessageId: true,
      telegramFileReference: true,
      storageChannel: { select: { id: true, telegramChannelId: true } },
      status: true,
    },
  });
  if (!file || file.status !== "active" || !file.mimeType.startsWith("video/")) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (file.thumbnailPublicId) {
    const thumbnail = await db.file.findUnique({
      where: { publicId: file.thumbnailPublicId },
      select: { sequenceNumber: true, mimeType: true, status: true },
    });
    if (thumbnail?.status === "active" && thumbnail.sequenceNumber != null) {
      return NextResponse.json({ thumbnailUrl: canonicalUrl(thumbnail.sequenceNumber, thumbnail.mimeType) });
    }
  }

  await telegramService.ensureStarted();
  if (telegramService.getStatus() !== "connected") {
    return NextResponse.json({ error: "THUMBNAIL_UNAVAILABLE" }, { status: 503 });
  }

  try {
    const result = await telegramService.downloadFile(
      file.storageChannel.telegramChannelId,
      file.telegramMessageId,
      file.telegramFileReference
    );
    if (result.refreshedReferenceB64 && result.refreshedReferenceB64 !== file.telegramFileReference) {
      await db.file.update({ where: { id: file.id }, data: { telegramFileReference: result.refreshedReferenceB64 } });
    }

    const publicId = await tryCreateVideoThumbnail({
      videoBuffer: result.bytes,
      videoSequence: file.sequenceNumber ?? file.id,
      channelId: file.storageChannel.id,
      telegramChannelId: file.storageChannel.telegramChannelId,
    });
    if (!publicId) return NextResponse.json({ error: "THUMBNAIL_UNAVAILABLE" }, { status: 503 });

    const thumbnail = await db.file.findUnique({
      where: { publicId },
      select: { sequenceNumber: true, mimeType: true },
    });
    if (!thumbnail?.sequenceNumber) return NextResponse.json({ error: "THUMBNAIL_UNAVAILABLE" }, { status: 503 });

    await db.file.update({ where: { id: file.id }, data: { thumbnailPublicId: publicId } });
    return NextResponse.json({ thumbnailUrl: canonicalUrl(thumbnail.sequenceNumber, thumbnail.mimeType) }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return NextResponse.json({ error: "THUMBNAIL_UNAVAILABLE" }, { status: 503 });
  }
}
