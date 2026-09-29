import { db } from "@/lib/db";
import { cache } from "@/lib/cache";
import { formatSequence } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";

export async function findSharedFile(fileId: number, folderIds: Set<number>) {
  if (!Number.isInteger(fileId) || fileId <= 0) return null;
  const file = await db.file.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      extension: true,
      size: true,
      sequenceNumber: true,
      status: true,
      telegramMessageId: true,
      telegramFileReference: true,
      storageChannel: { select: { telegramChannelId: true } },
      folderId: true,
    },
  });
  if (!file || file.status !== "active" || file.folderId === null || !folderIds.has(file.folderId)) return null;
  return { ...file, size: Number(file.size) };
}

export async function getSharedFileBytes(file: Awaited<ReturnType<typeof findSharedFile>>) {
  if (!file) return null;
  const cacheKey = file.sequenceNumber != null ? formatSequence(file.sequenceNumber) : `legacy-${file.id}`;
  const cached = await cache.getBytes(cacheKey);
  if (cached) return { bytes: cached, refreshedReferenceB64: undefined };

  await telegramService.ensureStarted();
  if (telegramService.getStatus() !== "connected") return null;

  const result = await telegramService.downloadFile(
    file.storageChannel.telegramChannelId,
    file.telegramMessageId,
    file.telegramFileReference
  );

  if (result.refreshedReferenceB64 && result.refreshedReferenceB64 !== file.telegramFileReference) {
    await db.file.update({
      where: { id: file.id },
      data: { telegramFileReference: result.refreshedReferenceB64 },
    });
  }

  await cache.setBytes(cacheKey, result.bytes);
  await cache.setMeta(cacheKey, {
    mimeType: file.mimeType,
    size: result.bytes.length,
    status: "active",
    updatedAt: new Date().toISOString(),
  });

  if (result.bytes.length !== file.size) {
    void db.file.update({ where: { id: file.id }, data: { size: result.bytes.length } }).catch(() => {});
  }

  return result;
}
