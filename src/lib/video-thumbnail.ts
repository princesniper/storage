import { promises as fs } from "fs";
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

async function processOne(fileId: number) {
  const file = await db.file.findUnique({
    where: { id: fileId },
    include: { storageChannel: { select: { telegramChannelId: true } } },
  });
  if (!file || file.status !== "active" || !file.mimeType.startsWith("video/")) return;
  if (file.previewStatus === "ready" && file.previewUrl) return;

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
    const downloaded = await telegramService.downloadFileToPath(
      file.storageChannel.telegramChannelId,
      file.telegramMessageId,
      file.telegramFileReference,
      sourcePath,
      file.telegramAccessHash,
    );

    if (downloaded.refreshedReferenceB64) {
      await db.file.update({
        where: { id: file.id },
        data: { telegramFileReference: downloaded.refreshedReferenceB64 },
      });
    }

    const duration = await probeDuration(sourcePath);
    const seek = duration <= 0 ? 0 : Math.min(1.5, Math.max(0, duration * 0.25));

    await runCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-ss", seek.toFixed(3),
        "-i", sourcePath,
        "-frames:v", "1",
        "-vf", `scale=${THUMB_MAX_DIMENSION}:-2:force_original_aspect_ratio=decrease`,
        "-q:v", String(THUMB_QUALITY),
        "-y",
        outputPath,
      ],
      workDir,
      JOB_TIMEOUT_MS,
    );

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
      return;
    }

    logger.info("[VIDEO_THUMBNAIL] completed", {
      fileId: file.id,
      durationSeconds: duration,
      seekSeconds: seek,
      outputSize: stat.size,
      durationMs: Date.now() - startedAt,
    });
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
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function workerLoop() {
  if (running) return;
  running = true;
  try {
    const jobs: Promise<void>[] = [];
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
