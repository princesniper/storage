import { promises as fs } from "fs";
import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { canonicalPreviewUrl } from "@/lib/media-url";
import { isRawMime } from "@/lib/env";
import { telegramService } from "@/services/telegram";
import { logger } from "@/lib/logger";
import { rawExtensions } from "@/lib/raw";

const PREVIEW_MAX_DIMENSION = 2048;
const PREVIEW_QUALITY = 86;
const JOB_POLL_MS = 5000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_CONCURRENCY = 1;

let workerStarted = false;
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

function concurrency() {
  const n = Number.parseInt(process.env.DNG_PREVIEW_CONCURRENCY ?? String(DEFAULT_CONCURRENCY), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(3, n)) : DEFAULT_CONCURRENCY;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`DECODER_TIMEOUT:${command}`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`DECODER_EXIT:${command}:${code ?? "null"}:${signal ?? ""}:${stderr.trim().slice(0, 1000)}`));
    });
  });
}

async function optimizeJpeg(inputPath: string, outputPath: string) {
  const result = await sharp(inputPath, { failOn: "none" })
    .rotate()
    .resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: PREVIEW_QUALITY, progressive: true, mozjpeg: true })
    .toFile(outputPath);
  if (!result.width || !result.height || result.size <= 0) throw new Error("INVALID_PREVIEW_OUTPUT");
  return result;
}

async function decodeDngToJpeg(sourcePath: string, workDir: string) {
  try {
    // LibRaw's simple_dcraw -e uses the RAW container's thumbnail structures
    // rather than guessing JPEG offsets. It can emit JPEG or bitmap thumbnails;
    // Sharp normalizes either into the final web JPEG.
    await runCommand("simple_dcraw", ["-e", sourcePath], workDir, 90_000);
    const candidates = (await fs.readdir(workDir))
      .filter((name) => name.startsWith(path.basename(sourcePath) + ".thumb."))
      .map((name) => path.join(workDir, name));
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.size > 1024) return { source: candidate, decoder: "libraw-embedded" };
      } catch {}
    }
  } catch {}

  const decodedTiff = path.join(workDir, "decoded.tiff");
  // LibRaw handles DNG/RAW demosaic, camera WB and embedded camera matrices.
  // -o 1 explicitly targets sRGB; -w uses camera WB when available.
  await runCommand("dcraw_emu", ["-w", "-o", "1", "-T", "-O", decodedTiff, sourcePath], workDir, JOB_TIMEOUT_MS);
  return { source: decodedTiff, decoder: "libraw-dcraw_emu" };
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNG_PREVIEW_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function claimNextJob() {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const candidate = await db.file.findFirst({
    where: {
      status: "active",
      extension: { in: rawExtensions() },
      OR: [
        { previewStatus: "pending" },
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
      OR: [
        { previewStatus: "pending" },
        { previewStatus: "processing", previewProcessingStartedAt: { lt: staleBefore } },
      ],
    },
    data: { previewStatus: "processing", previewProcessingStartedAt: new Date(), previewError: null },
  });
  return claimed.count === 1 ? candidate.id : null;
}

async function processOne(fileId: number) {
  const file = await db.file.findUnique({
    where: { id: fileId },
    include: { storageChannel: { select: { id: true, telegramChannelId: true } } },
  });
  if (!file || file.status !== "active" || !isRawMime(file.mimeType)) return;
  if (file.previewStatus === "ready" && file.previewUrl) return;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "growplants-dng-"));
  const sourcePath = path.join(workDir, "original.dng");
  const outputPath = path.join(workDir, "preview.jpg");
  const startedAt = Date.now();

  logger.info("[DNG_PREVIEW] started", { fileId: file.id });

  try {
    const downloaded = await withTimeout(
      telegramService.downloadFileToPath(
        file.storageChannel.telegramChannelId,
        file.telegramMessageId,
        file.telegramFileReference,
        sourcePath,
        file.telegramAccessHash
      ),
      JOB_TIMEOUT_MS
    );
    if (downloaded.refreshedReferenceB64) {
      await db.file.update({
        where: { id: file.id },
        data: { telegramFileReference: downloaded.refreshedReferenceB64 },
      });
    }

    const decoded = await withTimeout(decodeDngToJpeg(sourcePath, workDir), JOB_TIMEOUT_MS);
    const jpeg = await withTimeout(optimizeJpeg(decoded.source, outputPath), 90_000);
    const stat = await fs.stat(outputPath);

    await telegramService.ensureStarted();
    if (telegramService.getStatus() !== "connected") throw new Error("STORAGE_UNAVAILABLE");

    const previewName = `${path.parse(file.originalName).name || "raw"}-preview.jpg`;
    const upload = await telegramService.uploadFileFromPath(
      file.storageChannel.telegramChannelId,
      outputPath,
      stat.size,
      previewName
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
        previewWidth: jpeg.width,
        previewHeight: jpeg.height,
        previewError: null,
        previewGeneratedAt: new Date(),
        previewProcessingStartedAt: null,
      },
    });

    if (updated.count !== 1) {
      try { await telegramService.deleteMessage(file.storageChannel.telegramChannelId, upload.messageId); } catch {}
      return;
    }

    logger.info("[DNG_PREVIEW] completed", {
      fileId: file.id,
      decoder: decoded.decoder,
      width: jpeg.width,
      height: jpeg.height,
      outputSize: stat.size,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[DNG_PREVIEW] failed fileId=${file.id} reason=${message.slice(0, 500)}`);
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
  if (workerRunning) return;
  workerRunning = true;
  try {
    const slots = concurrency();
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < slots; i += 1) {
      const id = await claimNextJob();
      if (id == null) break;
      jobs.push(processOne(id));
    }
    if (jobs.length) await Promise.allSettled(jobs);
  } finally {
    workerRunning = false;
  }
}

export function startDngPreviewWorker() {
  if (workerStarted || process.env.NODE_ENV !== "production") return;
  workerStarted = true;
  void workerLoop();
  workerTimer = setInterval(() => void workerLoop(), JOB_POLL_MS);
  workerTimer.unref?.();
  logger.info("[DNG_PREVIEW] worker started", { concurrency: concurrency() });
}

export async function stopDngPreviewWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerStarted = false;
}
