/**
 * V2-Feature-7: video thumbnail generation (best-effort, optional).
 *
 * Extracts the first frame (00:00:01) of an uploaded video via ffmpeg,
 * uploads the JPEG to the SAME Telegram channel as a separate message,
 * and creates a File row for it so it can be served via /images/000002.jpg.
 *
 * The thumbnail consumes its own sequential media number (uniform 1:1
 * sequence↔file mapping, allocated atomically with the File row).
 *
 * Everything is defensive: fluent-ffmpeg missing, ffmpeg binary missing,
 * corrupt video, timeout — all resolve to `null` (caller shows a default
 * video icon instead). Never throws.
 *
 * NOTE: uses telegramService.uploadFile (public API) — no GramJS imports here.
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { generatePublicId } from "@/lib/public-id";
import { canonicalUrl, formatSequence } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";
import { logger } from "@/lib/logger";
import { cache } from "@/lib/cache";
import sharp from "sharp";

const THUMB_TIMEOUT_MS = 30_000;

export async function tryCreateVideoThumbnail(opts: {
  videoBuffer: Buffer;
  videoSequence: number;
  channelId: number;
  telegramChannelId: string;
}): Promise<string | null> {
  const { videoBuffer, videoSequence, channelId, telegramChannelId } = opts;
  const tmpDir = os.tmpdir();
  const tag = randomBytes(6).toString("hex");
  const inPath = path.join(tmpDir, `vidthumb-${tag}.mp4`);
  const outPath = path.join(tmpDir, `vidthumb-${tag}.jpg`);

  try {
    // fluent-ffmpeg is optional — dynamic import so a missing package
    // (or missing ffmpeg binary) degrades gracefully.
    let ffmpeg: typeof import("fluent-ffmpeg");
    try {
      ffmpeg = (await import("fluent-ffmpeg")).default;
    } catch {
      logger.warn("video thumbnail skipped: fluent-ffmpeg not installed");
      return null;
    }

    await fs.writeFile(inPath, videoBuffer);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ffmpeg timeout")), THUMB_TIMEOUT_MS);
      try {
        ffmpeg(inPath)
          .on("end", () => {
            clearTimeout(timer);
            resolve();
          })
          .on("error", (err: Error) => {
            clearTimeout(timer);
            reject(err);
          })
          .screenshots({
            timestamps: ["00:00:01"],
            filename: path.basename(outPath),
            folder: tmpDir,
            size: "640x?",
          });
      } catch (err) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    const thumbBuf = await fs.readFile(outPath);
    if (thumbBuf.length === 0) return null;

    if (telegramService.getStatus() !== "connected") {
      logger.warn("video thumbnail skipped: Telegram not connected");
      return null;
    }

    const thumbName = `thumb_${formatSequence(videoSequence)}.jpg`;
    const upload = await telegramService.uploadFile(
      telegramChannelId,
      thumbBuf,
      "image/jpeg",
      thumbName
    );

    // Unique legacy publicId for the thumbnail File row (keeps /i/ compat uniform)
    let thumbPublicId = generatePublicId();
    for (let attempts = 0; attempts < 5; attempts++) {
      const existing = await db.file.findUnique({
        where: { publicId: thumbPublicId },
        select: { id: true },
      });
      if (!existing) break;
      thumbPublicId = generatePublicId();
    }

    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(thumbBuf).metadata();
      if (meta.width && meta.height) {
        width = meta.width;
        height = meta.height;
      }
    } catch {
      /* non-fatal */
    }

    // Thumbnail consumes its own sequential number (uniform 1:1 mapping),
    // allocated atomically with the File row creation.
    const thumbRow = await db.$transaction(async (tx) => {
      const seq = await tx.mediaSequence.create({ data: {} });
      const publicUrl = canonicalUrl(seq.id, "image/jpeg");
      return tx.file.create({
        data: {
          publicId: thumbPublicId,
          sequenceNumber: seq.id,
          storageChannelId: channelId,
          originalName: thumbName,
          mimeType: "image/jpeg",
          extension: "jpg",
          size: thumbBuf.length,
          width,
          height,
          telegramMessageId: upload.messageId,
          telegramFileId: upload.fileId,
          telegramAccessHash: upload.accessHash,
          telegramFileReference: upload.fileReference,
          publicUrl,
          status: "active",
        },
      });
    });

    const thumbSeq = thumbRow.sequenceNumber;
    if (thumbSeq == null) throw new Error("thumbnail sequence allocation failed");
    const thumbCacheKey = formatSequence(thumbSeq);
    await cache.setBytes(thumbCacheKey, thumbBuf);
    await cache.setMeta(thumbCacheKey, {
      mimeType: "image/jpeg",
      size: thumbBuf.length,
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    logger.info("video thumbnail created", {
      videoSequence,
      thumbPublicId,
      thumbSequence: thumbRow.sequenceNumber,
    });
    return thumbPublicId;
  } catch (e) {
    logger.warn("video thumbnail failed (non-fatal, showing default icon)", {
      err: e instanceof Error ? e.message : String(e),
      videoSequence,
    });
    return null;
  } finally {
    // Best-effort temp cleanup
    for (const p of [inPath, outPath]) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore */
      }
    }
  }
}
