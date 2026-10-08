import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/services/audit";
import { telegramService, setTelegramUploadProgress, setTelegramUploadResult, setTelegramUploadFailure } from "@/services/telegram";
import { generatePublicId } from "@/lib/public-id";
import { canonicalUrl } from "@/lib/media-url";
import { isAllowedDetectedMime, isRawMime, isVideoMime, maxFileSizeBytes, maxRawSizeBytes, maxVideoSizeBytes, normalizeMimeType } from "@/lib/env";
import { rawMimeFromName } from "@/lib/raw";
import {
  assembleUpload,
  cleanupUpload,
  readFileHead,
  readUploadManifest,
} from "@/lib/resumable-upload";

async function processUpload(uploadId: string, assembled: string, adminEmail: string) {
  const manifest = await readUploadManifest(uploadId);
  const channel = await db.storageChannel.findFirst({
    where: { id: manifest.channelId, status: "active" },
  });
  if (!channel) throw new Error("CHANNEL_NOT_FOUND_OR_INACTIVE");

  await telegramService.ensureStarted();
  if (telegramService.getStatus() !== "connected") {
    throw new Error(telegramService.getLastError() ?? "Telegram client is not connected.");
  }

  const head = await readFileHead(assembled);
  const detected = await fileTypeFromBuffer(head);
  const rawMime = rawMimeFromName(manifest.fileName);
  const detectedMime = normalizeMimeType(
    rawMime && (!detected?.mime || detected.mime === "application/octet-stream" || detected.mime === "image/tiff")
      ? rawMime
      : detected?.mime ?? manifest.mimeType
  );
  if (!detectedMime || !isAllowedDetectedMime(detectedMime)) {
    throw new Error(`UNSUPPORTED_MIME:${detectedMime || "unknown"}`);
  }
  const typeLimit = isVideoMime(detectedMime)
    ? maxVideoSizeBytes
    : isRawMime(detectedMime)
      ? maxRawSizeBytes
      : maxFileSizeBytes;
  if (manifest.size > typeLimit) {
    throw new Error(`FILE_TOO_LARGE:${Math.round(typeLimit / 1024 / 1024)}`);
  }

  let width: number | null = null;
  let height: number | null = null;
  if (!isVideoMime(detectedMime)) {
    try {
      const meta = await sharp(assembled).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {}
  }

  setTelegramUploadProgress(uploadId, 0, "telegram");
  const upload = await telegramService.uploadFileFromPath(
    channel.telegramChannelId,
    assembled,
    manifest.size,
    manifest.fileName,
    undefined,
    uploadId
  );

  const admin = await db.admin.findFirst({ where: { email: adminEmail } });
  let publicId = generatePublicId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await db.file.findUnique({ where: { publicId }, select: { id: true } });
    if (!existing) break;
    publicId = generatePublicId();
    if (attempt === 4) throw new Error("ID_GENERATION_FAILED");
  }

  const extension = manifest.fileName.includes(".")
    ? manifest.fileName.split(".").pop()!.toLowerCase()
    : "";
  let fileRow;
  try {
    fileRow = await db.$transaction(async (tx) => {
      const seq = await tx.mediaSequence.create({ data: {} });
      return tx.file.create({
        data: {
          publicId,
          sequenceNumber: seq.id,
          storageChannelId: channel.id,
          folderId: manifest.folderId,
          originalName: manifest.fileName,
          mimeType: detectedMime,
          extension,
          size: manifest.size,
          width,
          height,
          telegramMessageId: upload.messageId,
          telegramFileId: upload.fileId,
          telegramAccessHash: upload.accessHash,
          telegramFileReference: upload.fileReference,
          publicUrl: canonicalUrl(seq.id, detectedMime),
          status: "active",
          previewStatus: isRawMime(detectedMime) ? "pending" : "none",
        },
        include: { storageChannel: { select: { id: true, name: true } }, folder: { select: { id: true, name: true } } },
      });
    });
  } catch (error) {
    try { await telegramService.deleteMessage(channel.telegramChannelId, upload.messageId); } catch {}
    throw error;
  }

  await audit({
    operation: "UPLOAD",
    status: "SUCCESS",
    ip: "resumable",
    fileId: fileRow.id,
    adminId: admin?.id,
    metadata: {
      publicId,
      sequenceNumber: fileRow.sequenceNumber,
      channel: channel.name,
      originalName: manifest.fileName,
      size: manifest.size,
      mimeType: detectedMime,
      relativePath: manifest.relativePath,
      resumable: true,
    },
  });

  setTelegramUploadResult(uploadId, fileRow.publicUrl);
  return fileRow.publicUrl;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const adminEmail = (session.user as { email?: string }).email ?? "unknown";
  const body = await req.json().catch(() => null) as { uploadId?: string } | null;
  const uploadId = body?.uploadId?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
    return NextResponse.json({ error: "INVALID_UPLOAD_ID" }, { status: 400 });
  }

  let manifest;
  try {
    manifest = await readUploadManifest(uploadId);
  } catch {
    return NextResponse.json({ error: "UPLOAD_SESSION_NOT_FOUND" }, { status: 404 });
  }

  try {
    const assembled = await assembleUpload(uploadId);
    setTelegramUploadProgress(uploadId, 0, "telegram");

    // The HTTP request ends here. Telegram transfer continues independently,
    // so a slow 800 MB upload is no longer tied to Railway's request lifecycle.
    void processUpload(uploadId, assembled, adminEmail)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setTelegramUploadFailure(uploadId, message);
      })
      .finally(async () => {
        await cleanupUpload(uploadId).catch(() => {});
      });

    return NextResponse.json({
      success: true,
      processing: true,
      uploadId,
      size: manifest.size,
    }, { status: 202 });
  } catch (error) {
    await cleanupUpload(uploadId).catch(() => {});
    return NextResponse.json({
      error: "UPLOAD_ASSEMBLY_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 400 });
  }
}
