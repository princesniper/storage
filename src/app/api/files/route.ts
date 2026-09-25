/**
 * GET /api/files?search=&channelId=&status=&page=&limit=&sort=&order=&mimeType=&minSize=&maxSize=&from=&to=
 * POST /api/files/upload (multipart: file + storageChannelId)
 *
 * V2: sorting (created|name|size + asc|desc), MIME filter, size range (bytes),
 *     date range (ISO strings), image dimensions via sharp on upload.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { cache } from "@/lib/cache";
import { env, allowedMimeTypes, maxFileSizeBytes, maxVideoSizeBytes, isVideoMime } from "@/lib/env";
import { generatePublicId } from "@/lib/public-id";
import { canonicalUrl, formatSequence } from "@/lib/media-url";
import { rateLimit } from "@/services/rate-limit";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import sharp from "sharp";
import { tryCreateVideoThumbnail } from "@/services/video-thumbnail";

const listQuerySchema = z.object({
  search: z.string().max(200).optional().default(""),
  channelId: z.string().optional().default("all"),
  folderId: z.string().optional().default("all"),
  status: z.enum(["active", "deleted", "missing", "all"]).optional().default("active"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(24),
  sort: z.enum(["created", "name", "size"]).optional().default("created"),
  order: z.enum(["asc", "desc"]).optional(),
  mimeType: z.string().max(100).optional(),
  minSize: z.coerce.number().int().min(0).optional(),
  maxSize: z.coerce.number().int().min(0).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function resolveOrder(sort: "created" | "name" | "size", order?: "asc" | "desc"): "asc" | "desc" {
  if (order) return order;
  return sort === "name" ? "asc" : "desc";
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;

  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const q = parsed.data;
  const search = q.search.trim();
  const page = q.page;
  const limit = q.limit;
  const order = resolveOrder(q.sort, q.order);

  const orderBy =
    q.sort === "name"
      ? { originalName: order }
      : q.sort === "size"
        ? { size: order }
        : { createdAt: order };

  const where: Record<string, unknown> = {};
  if (q.status !== "all") where.status = q.status;
  if (q.folderId !== "all") {
    const fid = Number(q.folderId);
    if (!Number.isInteger(fid) || fid <= 0) {
      return NextResponse.json({ error: "INVALID_FOLDER" }, { status: 400 });
    }
    where.folderId = fid;
  }
  if (q.channelId && q.channelId !== "all") {
    const cid = Number(q.channelId);
    if (!Number.isInteger(cid) || cid <= 0) {
      return NextResponse.json({ error: "INVALID_CHANNEL" }, { status: 400 });
    }
    where.storageChannelId = cid;
  }
  if (search) {
    where.OR = [
      { originalName: { contains: search } },
      { publicId: { contains: search } },
    ];
  }
  if (q.mimeType && q.mimeType !== "all") {
    where.mimeType = q.mimeType;
  }
  if (q.minSize !== undefined || q.maxSize !== undefined) {
    const sizeFilter: Record<string, number> = {};
    if (q.minSize !== undefined) sizeFilter.gte = q.minSize;
    if (q.maxSize !== undefined) sizeFilter.lte = q.maxSize;
    if (
      q.minSize !== undefined &&
      q.maxSize !== undefined &&
      q.minSize > q.maxSize
    ) {
      return NextResponse.json({ error: "INVALID_SIZE_RANGE" }, { status: 400 });
    }
    where.size = sizeFilter;
  }
  if (q.from || q.to) {
    const createdFilter: Record<string, Date> = {};
    if (q.from) {
      const d = new Date(q.from);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "INVALID_FROM_DATE" }, { status: 400 });
      }
      createdFilter.gte = d;
    }
    if (q.to) {
      const d = new Date(q.to);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "INVALID_TO_DATE" }, { status: 400 });
      }
      createdFilter.lte = d;
    }
    if (
      createdFilter.gte &&
      createdFilter.lte &&
      createdFilter.gte > createdFilter.lte
    ) {
      return NextResponse.json({ error: "INVALID_DATE_RANGE" }, { status: 400 });
    }
    where.createdAt = createdFilter;
  }

  const [files, total] = await Promise.all([
    db.file.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        storageChannel: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      },
    }),
    db.file.count({ where }),
  ]);

  const channels = await db.storageChannel.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
  });

  // Resolve canonical thumbnail URLs in one batch query.
  const thumbIds = [...new Set(files.map((f) => f.thumbnailPublicId).filter((v): v is string => v != null))];
  const thumbRows = thumbIds.length > 0
    ? await db.file.findMany({
        where: { publicId: { in: thumbIds } },
        select: { publicId: true, sequenceNumber: true, mimeType: true },
      })
    : [];
  const thumbUrlByPublicId = new Map<string, string>();
  for (const t of thumbRows) {
    if (t.sequenceNumber != null) {
      thumbUrlByPublicId.set(t.publicId, canonicalUrl(t.sequenceNumber, t.mimeType));
    }
  }

  return NextResponse.json({
    files: files.map((f) => ({
      id: f.id,
      publicId: f.publicId,
      sequenceNumber: f.sequenceNumber,
      originalName: f.originalName,
      mimeType: f.mimeType,
      size: Number(f.size),
      status: f.status,
      publicUrl: f.publicUrl,
      width: f.width,
      height: f.height,
      thumbnailPublicId: f.thumbnailPublicId,
      thumbnailUrl: f.thumbnailPublicId ? (thumbUrlByPublicId.get(f.thumbnailPublicId) ?? null) : null,
      createdAt: f.createdAt,
      storageChannel: f.storageChannel,
      folder: f.folder,
    })),
    total,
    page,
    limit,
    channels,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const adminEmail = (session.user as { email?: string }).email ?? "unknown";

  // Rate limit: 30 uploads/min/admin
  if (!rateLimit(`upload:${ip}`, env.RATE_LIMIT_UPLOAD_PER_MIN, 60_000).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const channelIdStr = form.get("storageChannelId");
  const folderIdRaw = form.get("folderId");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  }
  if (!channelIdStr) {
    return NextResponse.json({ error: "NO_CHANNEL" }, { status: 400 });
  }
  const channelId = Number(channelIdStr);
  if (!Number.isInteger(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "INVALID_CHANNEL" }, { status: 400 });
  }

  const folderId = folderIdRaw == null || folderIdRaw === "" ? null : Number(folderIdRaw);
  if (folderId !== null && (!Number.isInteger(folderId) || folderId <= 0)) {
    return NextResponse.json({ error: "INVALID_FOLDER" }, { status: 400 });
  }
  if (folderId !== null) {
    const folder = await db.folder.findUnique({ where: { id: folderId }, select: { id: true } });
    if (!folder) return NextResponse.json({ error: "FOLDER_NOT_FOUND" }, { status: 404 });
  }

  // Validate channel exists and is active
  const channel = await db.storageChannel.findFirst({
    where: { id: channelId, status: "active" },
  });
  if (!channel) {
    return NextResponse.json({ error: "CHANNEL_NOT_FOUND_OR_INACTIVE" }, { status: 400 });
  }

  // Absolute ceiling check before buffering (video limit is the largest allowed)
  const absoluteMax = Math.max(maxFileSizeBytes, maxVideoSizeBytes);
  if (file.size > absoluteMax) {
    return NextResponse.json(
      { error: "FILE_TOO_LARGE", maxMb: Math.round(absoluteMax / 1024 / 1024), receivedBytes: file.size },
      { status: 413 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
  }

  // Buffer the file
  const buf = Buffer.from(await file.arrayBuffer());

  // Magic byte MIME check (don't trust filename)
  const detected = await fileTypeFromBuffer(buf);
  const detectedMime = detected?.mime;
  if (!detectedMime || !allowedMimeTypes.includes(detectedMime)) {
    return NextResponse.json(
      { error: "UNSUPPORTED_MIME", detected: detectedMime ?? "unknown" },
      { status: 415 }
    );
  }
  // Cross-check: declared MIME (file.type) vs detected
  if (file.type && allowedMimeTypes.includes(file.type) && file.type !== detectedMime) {
    logger.warn("MIME mismatch — using detected", {
      declared: file.type,
      detected: detectedMime,
    });
  }

  // Per-type size limit (MIME determines the limit)
  const isVideo = isVideoMime(detectedMime);
  const typeLimit = isVideo ? maxVideoSizeBytes : maxFileSizeBytes;
  if (buf.length > typeLimit) {
    return NextResponse.json(
      {
        error: "FILE_TOO_LARGE",
        maxMb: Math.round(typeLimit / 1024 / 1024),
        receivedBytes: buf.length,
        kind: isVideo ? "video" : "image",
      },
      { status: 413 }
    );
  }

  // V2-Feature-5: image dimensions via sharp (images only; non-fatal if it fails)
  let width: number | null = null;
  let height: number | null = null;
  if (!isVideo) {
    try {
      const meta = await sharp(buf).metadata();
      if (meta.width && meta.height) {
        width = meta.width;
        height = meta.height;
      }
    } catch (e) {
      logger.warn("sharp metadata failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Telegram must be connected
  if (telegramService.getStatus() !== "connected") {
    return NextResponse.json({ error: "TELEGRAM_NOT_CONNECTED" }, { status: 503 });
  }

  // Upload to Telegram
  const originalName = file.name || `upload-${Date.now()}`;
  let upload;
  try {
    upload = await telegramService.uploadFile(
      channel.telegramChannelId,
      buf,
      detectedMime,
      originalName
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Telegram upload failed", { err: msg, channel: channel.id, size: buf.length });
    await audit({
      operation: "UPLOAD",
      status: "FAILED",
      ip,
      errorMessage: msg,
      metadata: { channel: channel.name, originalName, size: buf.length },
    });
    return NextResponse.json({ error: "UPLOAD_FAILED", detail: msg }, { status: 502 });
  }

  // Legacy random publicId (kept so /i/ compat works uniformly for new files).
  // The canonical identifier is the sequential number allocated below.
  let publicId = generatePublicId();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.file.findUnique({ where: { publicId }, select: { id: true } });
    if (!existing) break;
    publicId = generatePublicId();
    attempts++;
  }
  if (attempts >= 5) {
    logger.error("publicId collision after 5 attempts");
    return NextResponse.json({ error: "ID_GENERATION_FAILED" }, { status: 500 });
  }

  const ext = originalName.includes(".") ? originalName.split(".").pop()!.toLowerCase() : "";

  let fileRow;
  try {
    // Allocate the sequential media number + create the File row atomically.
    // The MediaSequence insert hands out a monotonic, never-reused id even
    // under concurrent uploads (no COUNT(*)/MAX() race).
    fileRow = await db.$transaction(async (tx) => {
      const seq = await tx.mediaSequence.create({ data: {} });
      const publicUrl = canonicalUrl(seq.id, detectedMime);
      return tx.file.create({
        data: {
          publicId,
          sequenceNumber: seq.id,
          storageChannelId: channel.id,
          folderId,
          originalName,
          mimeType: detectedMime,
          extension: ext,
          size: buf.length,
          width,
          height,
          telegramMessageId: upload.messageId,
          telegramFileId: upload.fileId,
          telegramAccessHash: upload.accessHash,
          telegramFileReference: upload.fileReference,
          publicUrl,
          status: "active",
        },
        include: {
          storageChannel: { select: { id: true, name: true } },
          folder: { select: { id: true, name: true } },
        },
      });
    });
  } catch (e) {
    // Best-effort cleanup: try to delete the Telegram message
    try {
      await telegramService.deleteMessage(channel.telegramChannelId, upload.messageId);
    } catch (cleanupErr) {
      logger.error("Telegram cleanup failed after DB write failure", {
        err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        messageId: upload.messageId,
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("DB write failed after Telegram upload", { err: msg });
    return NextResponse.json({ error: "DB_WRITE_FAILED", detail: msg }, { status: 500 });
  }

  // The transaction above always sets sequenceNumber; guard for type-safety.
  const sequenceNumber = fileRow.sequenceNumber;
  if (sequenceNumber == null) {
    logger.error("sequenceNumber missing after allocation (should be impossible)");
    return NextResponse.json({ error: "ID_GENERATION_FAILED" }, { status: 500 });
  }
  const cacheKey = formatSequence(sequenceNumber);

  // Pre-warm cache (keyed by zero-padded sequence, same namespace as before)
  try {
    await cache.setBytes(cacheKey, buf);
    await cache.setMeta(cacheKey, {
      mimeType: detectedMime,
      size: buf.length,
      status: "active",
      updatedAt: fileRow.updatedAt.toISOString(),
    });
  } catch (cacheErr) {
    logger.warn("cache pre-warm failed (non-fatal)", {
      err: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
    });
  }

  // V2-Feature-7: best-effort video thumbnail (first frame → same channel)
  let thumbnailPublicId: string | null = null;
  if (isVideo) {
    thumbnailPublicId = await tryCreateVideoThumbnail({
      videoBuffer: buf,
      videoSequence: sequenceNumber,
      channelId: channel.id,
      telegramChannelId: channel.telegramChannelId,
    });
    if (thumbnailPublicId) {
      try {
        fileRow = await db.file.update({
          where: { id: fileRow.id },
          data: { thumbnailPublicId },
          include: { storageChannel: { select: { id: true, name: true } } },
        });
      } catch (e) {
        logger.warn("thumbnailPublicId persist failed (non-fatal)", {
          err: e instanceof Error ? e.message : String(e),
        });
        thumbnailPublicId = null;
      }
    }
  }

  // Get admin id for audit
  const admin = await db.admin.findFirst({ where: { email: adminEmail } });

  await audit({
    operation: "UPLOAD",
    status: "SUCCESS",
    ip,
    fileId: fileRow.id,
    adminId: admin?.id,
    metadata: {
      publicId,
      sequenceNumber,
      channel: channel.name,
      originalName,
      size: buf.length,
      mimeType: detectedMime,
      width,
      height,
    },
  });

  logger.info("upload ok", { sequenceNumber, publicId, channel: channel.name, size: buf.length });

  return NextResponse.json({
    success: true,
    file: {
      id: fileRow.publicId,
      dbId: fileRow.id,
      sequenceNumber,
      name: fileRow.originalName,
      mimeType: fileRow.mimeType,
      size: Number(fileRow.size),
      width: fileRow.width,
      height: fileRow.height,
      thumbnailPublicId: fileRow.thumbnailPublicId,
      url: fileRow.publicUrl,
      // Alias — canonical public media URL (https://m.media-growplants.com/images/NNNNNN.ext).
      // `url` is kept for backwards compatibility with the upload client.
      publicUrl: fileRow.publicUrl,
      channel: { id: channel.id, name: channel.name },
      folder: fileRow.folder,
      createdAt: fileRow.createdAt,
    },
  }, { status: 201 });
}
