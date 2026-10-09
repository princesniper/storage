import { promises as fs } from "fs";
import sharp from "sharp";
import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import { db } from "@/lib/db";
import { canonicalPreviewUrl } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";
import { logger } from "@/lib/logger";

const POLL_MS = 5000;
const STALE_MS = 30 * 60 * 1000;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CONCURRENCY = 1;
const THUMB_MAX_DIMENSION = 1280;
const THUMB_QUALITY = 3;

let started = false;
let timer: NodeJS.Timeout | null = null;
let running = false;

function concurrency() {
  const n = Number.parseInt(process.env.VIDEO_THUMBNAIL_CONCURRENCY ?? String(DEFAULT_CONCURRENCY), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(2, n)) : DEFAULT_CONCURRENCY;
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`VIDEO_DECODER_TIMEOUT:${command}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 4000) stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 4000) stderr += String(chunk); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout.trim());
      reject(new Error(`VIDEO_DECODER_EXIT:${command}:${code ?? "null"}:${signal ?? ""}:${stderr.trim().slice(0, 1200)}`));
    });
  });
}

async function probeDuration(sourcePath: string): Promise<number> {
  const raw = await runCommand(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath],
    path.dirname(sourcePath),
    30_000,
  );
  const duration = Number.parseFloat(raw);
  if (!Number.isFinite(duration) || duration < 0) throw new Error("VIDEO_DURATION_UNAVAILABLE");
  return duration;
}

async function validateThumbnail(thumbnailPath: string): Promise<void> {
  const metadata = await sharp(thumbnailPath).metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
    throw new Error("INVALID_VIDEO_THUMBNAIL");
  }
}

/**
 * Generate a preview from the assembled local upload before sending the
 * original to Telegram. This avoids downloading a 300–800 MiB video back
 * from Telegram just because its document thumbnail is absent or unusable.
 */
export async function generateVideoThumbnailFromPath(sourcePath: string, outputPath: string): Promise<number> {
  const workDir = path.dirname(outputPath);
  let duration = 0;
  try {
    duration = await probeDuration(sourcePath);
  } catch {
    // Try a small set of early timestamps even if the container duration
    // cannot be probed; the upload itself should not be blocked by previews.
  }

  const candidates = [...new Set([
    0,
    0.5,
    duration > 1 ? Math.min(5, duration * 0.1) : 1.5,
    duration > 2 ? duration * 0.5 : 2,
  ].map((value) => Math.max(0, value).toFixed(3)))];

  let lastError: unknown = null;
  for (const timestamp of candidates) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
    try {
      await runCommand(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error",
          "-ss", timestamp,
          "-i", sourcePath,
          "-frames:v", "1",
          "-vf", `scale=${THUMB_MAX_DIMENSION}:-2:force_original_aspect_ratio=decrease`,
          "-q:v", String(THUMB_QUALITY),
          "-y", outputPath,
        ],
        workDir,
        30_000,
      );
      await validateThumbnail(outputPath);
      const stat = await fs.stat(outputPath);
      if (stat.size <= 0) throw new Error("EMPTY_VIDEO_THUMBNAIL");
      return stat.size;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("VIDEO_THUMBNAIL_EXTRACTION_FAILED");
}

async function claimNextJob() {
  const staleBefore = new Date(Date.now() - STALE_MS);
  const candidate = await db.file.findFirst({
    where: {
      status: "active",
      mimeType: { startsWith: "video/" },
      OR: [
        { previewStatus: "none" },
        { previewStatus: "pending" },
        { previewStatus: "failed", previewRetryCount: { lt: 3 } },
        { previewStatus: "processing", previewProcessingStartedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await db.file.updateMany({
    where: {
      id: candidate.id,
      status: "active",
      mimeType: { startsWith: "video/" },
      OR: [
        { previewStatus: "none" },
        { previewStatus: "pending" },
        { previewStatus: "failed", previewRetryCount: { lt: 3 } },
        { previewStatus: "processing", previewProcessingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      previewStatus: "processing",
      previewProcessingStartedAt: new Date(),
      previewError: null,
      previewRetryCount: { increment: 1 },
    },
  });
  return claimed.count === 1 ? candidate.id : null;
}

async function processOne(fileId: number): Promise<boolean> {
  const file = await db.file.findUnique({
    where: { id: fileId },
    include: { storageChannel: { select: { telegramChannelId: true } } },
  });
  if (!file || file.status !== "active" || !file.mimeType.startsWith("video/")) return false;
  if (file.previewStatus === "ready" && file.previewUrl) return true;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "growplants-video-"));
  const sourcePath = path.join(workDir, "original.video");
  const outputPath = path.join(workDir, "thumbnail.jpg");
  const startedAt = Date.now();

  logger.info("[VIDEO_THUMBNAIL] started", {
    fileId: file.id,
    sizeBytes: Number(file.size),
    mimeType: file.mimeType,
  });

  try {
    const telegramStartedAt = Date.now();
    let sourceBytes = 0;
    let sourceMode = "telegram-thumbnail";
    let thumbnailReady = false;

    // Fast path: Telegram may already have generated a document thumbnail.
    // If the thumbnail is malformed or FFmpeg cannot decode it, continue to
    // the bounded-prefix/original fallback instead of failing the whole job.
    const telegramThumb = await telegramService.downloadVideoThumbnail(
      file.storageChannel.telegramChannelId,
      file.telegramMessageId,
    );
    if (telegramThumb) {
      try {
        await fs.writeFile(sourcePath, telegramThumb);
        sourceBytes = telegramThumb.length;
        await runCommand(
          "ffmpeg",
          [
            "-hide_banner", "-loglevel", "error",
            "-i", sourcePath,
            "-frames:v", "1",
            "-vf", `scale=${THUMB_MAX_DIMENSION}:-2:force_original_aspect_ratio=decrease`,
            "-q:v", String(THUMB_QUALITY),
            "-y", outputPath,
          ],
          workDir,
          60_000,
        );
        await validateThumbnail(outputPath);
        thumbnailReady = true;
      } catch (error) {
        logger.warn("[VIDEO_THUMBNAIL] Telegram thumbnail unusable; falling back", {
          fileId: file.id,
          reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
        await fs.rm(sourcePath, { force: true }).catch(() => {});
        await fs.rm(outputPath, { force: true }).catch(() => {});
        sourceMode = "partial-prefix";
      }
    }

    if (!thumbnailReady) {
      // Fetch only a small bounded prefix first. Some MP4/MOV containers place
      // moov at the end; that case explicitly falls back to a disk-backed full
      // download, never a full-video Node Buffer.
      sourceMode = "partial-prefix";
      const partial = await telegramService.downloadFilePrefixToPath(
        file.storageChannel.telegramChannelId,
        file.telegramMessageId,
        file.telegramFileId,
        file.telegramAccessHash,
        file.telegramFileReference,
        sourcePath,
        8 * 1024 * 1024,
      );
      sourceBytes = partial.bytes;
      if (partial.refreshedReferenceB64) {
        await db.file.update({ where: { id: file.id }, data: { telegramFileReference: partial.refreshedReferenceB64 } });
      }

      try {
        await runCommand(
          "ffmpeg",
          [
            "-hide_banner", "-loglevel", "error",
            "-ss", "0.5",
            "-i", sourcePath,
            "-frames:v", "1",
            "-vf", `scale=${THUMB_MAX_DIMENSION}:-2:force_original_aspect_ratio=decrease`,
            "-q:v", String(THUMB_QUALITY),
            "-y", outputPath,
          ],
          workDir,
          60_000,
        );
        await validateThumbnail(outputPath);
      } catch {
        sourceMode = "full-source-fallback";
        await fs.rm(outputPath, { force: true }).catch(() => {});
        const downloaded = await telegramService.downloadFileToPath(
          file.storageChannel.telegramChannelId,
          file.telegramMessageId,
          file.telegramFileReference,
          sourcePath,
          file.telegramAccessHash,
        );
        const stat = await fs.stat(sourcePath);
        sourceBytes = stat.size;
        if (downloaded.refreshedReferenceB64) {
          await db.file.update({ where: { id: file.id }, data: { telegramFileReference: downloaded.refreshedReferenceB64 } });
        }
        const duration = await probeDuration(sourcePath);
        const seek = duration <= 0 ? 0 : Math.min(1.5, Math.max(0, duration * 0.1));
        await runCommand(
          "ffmpeg",
          [
            "-hide_banner", "-loglevel", "error",
            "-ss", seek.toFixed(3), "-i", sourcePath,
            "-frames:v", "1",
            "-vf", `scale=${THUMB_MAX_DIMENSION}:-2:force_original_aspect_ratio=decrease`,
            "-q:v", String(THUMB_QUALITY), "-y", outputPath,
          ],
          workDir,
          JOB_TIMEOUT_MS,
        );
        await validateThumbnail(outputPath);
      }
    }

    logger.info("[VIDEO_THUMBNAIL] source-ready", {
      fileId: file.id,
      sourceMode,
      sourceBytes,
      sourceMs: Date.now() - telegramStartedAt,
    });

    const stat = await fs.stat(outputPath);
    if (stat.size <= 0) throw new Error("EMPTY_VIDEO_THUMBNAIL");

    await telegramService.ensureStarted();
    if (telegramService.getStatus() !== "connected") throw new Error("STORAGE_UNAVAILABLE");

    const previewName = `${path.parse(file.originalName).name || "video"}-thumbnail.jpg`;
    const upload = await telegramService.uploadFileFromPath(
      file.storageChannel.telegramChannelId,
      outputPath,
      stat.size,
      previewName,
    );

    const previewUrl = canonicalPreviewUrl(file.sequenceNumber ?? file.id);
    const updated = await db.file.updateMany({
      where: { id: file.id, status: "active", previewStatus: "processing" },
      data: {
        previewStatus: "ready",
        previewUrl,
        previewMimeType: "image/jpeg",
        previewSize: stat.size,
        previewTelegramMessageId: upload.messageId,
        previewTelegramFileId: upload.fileId,
        previewTelegramAccessHash: upload.accessHash,
        previewTelegramFileReference: upload.fileReference,
        previewError: null,
        previewGeneratedAt: new Date(),
        previewProcessingStartedAt: null,
        previewRetryCount: 0,
      },
    });

    if (updated.count !== 1) {
      try { await telegramService.deleteMessage(file.storageChannel.telegramChannelId, upload.messageId); } catch {}
      return false;
    }

    logger.info("[VIDEO_THUMBNAIL] completed", {
      fileId: file.id,
      sourceMode,
      sourceBytes,
      outputSize: stat.size,
      durationMs: Date.now() - startedAt,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[VIDEO_THUMBNAIL] failed", {
      fileId: file.id,
      reason: message.slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    await db.file.updateMany({
      where: { id: file.id, previewStatus: "processing" },
      data: {
        previewStatus: "failed",
        previewError: message.slice(0, 500),
        previewProcessingStartedAt: null,
      },
    });
    return false;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function workerLoop() {
  if (running) return;
  running = true;
  try {
    const jobs: Promise<boolean>[] = [];
    for (let i = 0; i < concurrency(); i += 1) {
      const id = await claimNextJob();
      if (id == null) break;
      jobs.push(processOne(id));
    }
    if (jobs.length) await Promise.allSettled(jobs);
  } finally {
    running = false;
  }
}

export function triggerVideoThumbnailWorker() {
  if (process.env.NODE_ENV !== "production") return;
  void workerLoop();
}

export async function runVideoThumbnailBackfill(options?: {
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
}) {
  const limit = Math.max(0, options?.limit ?? Number.POSITIVE_INFINITY);
  const dryRun = options?.dryRun ?? false;
  if (dryRun) {
    return db.file.count({
      where: {
        status: "active",
        mimeType: { startsWith: "video/" },
        OR: [
          { previewStatus: "none" },
          { previewStatus: "pending" },
          { previewStatus: "failed", previewRetryCount: { lt: 3 } },
          { previewStatus: "processing", previewProcessingStartedAt: { lt: new Date(Date.now() - STALE_MS) } },
        ],
      },
    });
  }

  let processed = 0;
  let success = 0;
  let failed = 0;
  const workers = Math.max(1, Math.min(2, options?.concurrency ?? 1));

  while (processed < limit) {
    const jobs: Promise<{ id: number; ok: boolean }>[] = [];
    for (let i = 0; i < workers && processed + i < limit; i += 1) {
      const id = await claimNextJob();
      if (id == null) break;
      jobs.push(processOne(id).then((ok) => ({ id, ok })).catch(() => ({ id, ok: false })));
    }
    if (!jobs.length) break;
    const results = await Promise.all(jobs);
    for (const result of results) {
      processed += 1;
      if (result.ok) success += 1;
      else failed += 1;
    }
    logger.info("[VIDEO_THUMBNAIL] backfill-progress", { processed, success, failed, limit });
  }

  return { processed, success, failed };
}

export function startVideoThumbnailWorker() {
  if (started || process.env.NODE_ENV !== "production") return;
  started = true;
  void workerLoop();
  timer = setInterval(() => void workerLoop(), POLL_MS);
  timer.unref?.();
  logger.info("[VIDEO_THUMBNAIL] worker started", { concurrency: concurrency() });
}

export async function stopVideoThumbnailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
