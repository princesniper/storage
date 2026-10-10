/**
 * GET /api/files/:id — return file metadata + audit history (id can be numeric DB id or publicId)
 * DELETE /api/files/:id — soft delete + cache invalidate + telegram delete attempt
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleFolderIds, withNonRemovedStorageChannel } from "@/lib/active-library";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { cache } from "@/lib/cache";
import { canonicalUrl, formatSequence } from "@/lib/media-url";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }

async function findFile(id: string) {
  // Try numeric id first, then publicId
  const numeric = Number(id);
  if (Number.isInteger(numeric) && numeric > 0) {
    const f = await db.file.findFirst({
      where: withNonRemovedStorageChannel({ id: numeric }),
      include: { storageChannel: { select: { id: true, name: true, telegramChannelId: true } } },
    });
    if (f) return f;
  }
  return db.file.findFirst({
    where: withNonRemovedStorageChannel({ publicId: id }),
    include: { storageChannel: { select: { id: true, name: true, telegramChannelId: true } } },
  });
}

export async function GET(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await ctx.params;
  const file = await findFile(id);
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const logs = await db.uploadLog.findMany({
    where: { fileId: file.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { admin: { select: { email: true } } },
  });

  let thumbnailUrl: string | null = null;
  if (file.thumbnailPublicId) {
    const thumb = await db.file.findUnique({
      where: { publicId: file.thumbnailPublicId },
      select: { sequenceNumber: true, mimeType: true },
    });
    if (thumb && thumb.sequenceNumber != null) {
      thumbnailUrl = canonicalUrl(thumb.sequenceNumber, thumb.mimeType);
    }
  }

  return NextResponse.json({
    file: {
      id: file.id,
      publicId: file.publicId,
      sequenceNumber: file.sequenceNumber,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: Number(file.size),
      status: file.status,
      // Rebuild legacy public URLs from canonical sequence + MIME.
      publicUrl: file.sequenceNumber != null ? canonicalUrl(file.sequenceNumber, file.mimeType) : file.publicUrl,
      width: file.width,
      height: file.height,
      thumbnailPublicId: file.thumbnailPublicId,
      previewStatus: file.previewStatus,
      previewUrl: file.previewUrl,
      previewMimeType: file.previewMimeType,
      previewSize: file.previewSize,
      previewWidth: file.previewWidth,
      previewHeight: file.previewHeight,
      previewError: file.previewError,
      previewGeneratedAt: file.previewGeneratedAt,
      thumbnailUrl,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      deletedAt: file.deletedAt,
      telegramMessageId: file.telegramMessageId,
      channel: { id: file.storageChannel.id, name: file.storageChannel.name },
      folder: file.folderId ? { id: file.folderId } : null,
      history: logs.map((l) => ({
        id: l.id,
        operation: l.operation,
        status: l.status,
        errorMessage: l.errorMessage,
        ip: l.ip,
        adminEmail: l.admin?.email ?? null,
        createdAt: l.createdAt,
      })),
    },
  });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { id } = await ctx.params;

  const file = await findFile(id);
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (file.status === "deleted") {
    return NextResponse.json({ error: "ALREADY_DELETED" }, { status: 409 });
  }

  // 1. Mark deleted immediately (public URL becomes 404 instantly)
  await db.file.update({
    where: { id: file.id },
    data: {
      status: "deleted",
      deletedAt: new Date(),
    },
  });

  // 2. Invalidate cache (sequence-keyed; legacy publicId key as fallback)
  if (file.sequenceNumber != null) {
    await cache.invalidate(formatSequence(file.sequenceNumber));
  } else {
    await cache.invalidate(file.publicId);
  }

  // 3. Attempt Telegram deletion — best-effort
  let telegramDeleteOk = false;
  let telegramDeleteError: string | undefined;
  if (telegramService.getStatus() === "connected") {
    try {
      await telegramService.deleteMessage(file.storageChannel.telegramChannelId, file.telegramMessageId);
      telegramDeleteOk = true;
    } catch (e) {
      telegramDeleteError = e instanceof Error ? e.message : String(e);
      logger.warn("Telegram delete failed (file marked deleted in DB anyway)", {
        err: telegramDeleteError,
        fileId: file.id,
        messageId: file.telegramMessageId,
      });
    }
  }

  const admin = await db.admin.findFirst({ where: { email: (session.user as { email?: string }).email ?? "" } });

  await audit({
    operation: "DELETE",
    status: telegramDeleteOk ? "SUCCESS" : "PARTIAL",
    ip,
    fileId: file.id,
    adminId: admin?.id,
    errorMessage: telegramDeleteError,
    metadata: {
      publicId: file.publicId,
      telegramDeleted: telegramDeleteOk,
    },
  });

  return NextResponse.json({ success: true, telegramDeleted: telegramDeleteOk });
}


export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await ctx.params;
  const file = await findFile(id);
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (file.status === "deleted") return NextResponse.json({ error: "FILE_DELETED" }, { status: 409 });

  const body = await req.json().catch(() => null);
  const folderId = body?.folderId === null || body?.folderId === "root"
    ? null
    : Number(body?.folderId);

  if (folderId !== null && (!Number.isInteger(folderId) || folderId <= 0)) {
    return NextResponse.json({ error: "INVALID_FOLDER" }, { status: 400 });
  }

  if (folderId !== null) {
    const visibleFolderIds = await getVisibleFolderIds(db);
    if (!visibleFolderIds.has(folderId)) return NextResponse.json({ error: "FOLDER_NOT_FOUND" }, { status: 404 });
  }

  const updated = await db.file.update({
    where: { id: file.id },
    data: { folderId },
    select: { id: true, folderId: true },
  });

  return NextResponse.json({ success: true, file: updated });
}
