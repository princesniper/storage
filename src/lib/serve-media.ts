/**
 * Shared media-serving logic for public file endpoints.
 *
 * Used by GET /images/[file] (canonical sequential URLs). The legacy
 * GET /i/[publicId] route only redirects — it does not serve bytes.
 *
 * Flow (identical to the former /i/ handler):
 *   1. Caller resolves the File row (by sequence number) + enforces status
 *   2. Cache hit (Redis primary, LRU fallback)? → serve from cache
 *   3. Cache miss → Telegram downloadMedia (refreshes fileReference if expired)
 *   4. Content-Type, Content-Length, ETag, Cache-Control
 *   5. For video: Accept-Ranges + HTTP Range (206 partial content)
 *   6. Warm cache for next time
 *
 * Cache keys are the zero-padded sequence string ("000042").
 */
import { db } from "@/lib/db";
import { cache } from "@/lib/cache";
import { formatSequence } from "@/lib/media-url";
import { isRawMime } from "@/lib/env";
import { telegramService } from "@/services/telegram";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";

export const NEGATIVE_TTL = 60; // seconds — short cache for missing files
export const PUBLIC_TTL = 86400; // 24h public cache
// Bound each Telegram-backed video range request for responsive playback.
export const MAX_VIDEO_RANGE_BYTES = 4 * 1024 * 1024;
export const MAX_RAW_RANGE_BYTES = 2 * 1024 * 1024;

export interface ServableFile {
  id: number;
  sequenceNumber: number;
  mimeType: string;
  size: number;
  status: string;
  sha256: string | null;
  telegramMessageId: number;
  telegramFileId: string;
  telegramAccessHash: string | null;
  telegramFileReference: string;
  storageChannel: { telegramChannelId: string };
}

export async function loadFileBySequence(sequenceNumber: number): Promise<ServableFile | null> {
  const file = await db.file.findUnique({
    where: { sequenceNumber },
    select: {
      id: true,
      sequenceNumber: true,
      mimeType: true,
      size: true,
      status: true,
      sha256: true,
      telegramMessageId: true,
      telegramFileId: true,
      telegramAccessHash: true,
      telegramFileReference: true,
      storageChannel: { select: { telegramChannelId: true } },
    },
  });
  if (!file || file.sequenceNumber == null) return null;
  return { ...file, sequenceNumber: file.sequenceNumber, size: Number(file.size) };
}

export function cacheKeyFor(sequenceNumber: number): string {
  return formatSequence(sequenceNumber);
}

export async function respondWithFileBytes(file: ServableFile, req: Request): Promise<Response> {
  const publicId = cacheKeyFor(file.sequenceNumber);
  const isVideo = file.mimeType.startsWith("video/");
  const isAudio = file.mimeType.startsWith("audio/");
  const isRaw = isRawMime(file.mimeType);
  const supportsRange = isVideo || isAudio || isRaw;
  const rangeHeader = req.headers.get("range");

  // Never cache complete video/audio payloads in memory/Redis. Large media must
  // remain range-streamed; only small image-like assets use the byte cache.
  const cached = isVideo || isAudio ? undefined : await cache.getBytes(publicId);
  if (cached) {
    return serveBytes(cached, file.mimeType, Number(file.size), file.sha256 ?? undefined, supportsRange, rangeHeader);
  }

  // Cache miss → fetch from Telegram.
  // Ensure the stored session has been loaded first: on a fresh process
  // getStatus() is "disconnected" until boot runs, which would wrongly
  // 502 every image right after a restart.
  await telegramService.ensureStarted();
  if (telegramService.getStatus() !== "connected") {
    logger.warn("public fetch but Telegram not connected", {
      sequenceNumber: file.sequenceNumber,
      detail: telegramService.getLastError(),
    });
    return new Response(JSON.stringify({ error: "STORAGE_UNAVAILABLE" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  let bytes: Buffer;
  let refreshedReferenceB64: string | undefined;
  try {
    // Video requests normally arrive with HTTP Range. Fetch only that range
    // from Telegram instead of downloading the entire video before responding.
    if (supportsRange && rangeHeader) {
      const parsed = parseRange(rangeHeader, Number(file.size));
      if (!parsed) {
        return new Response(JSON.stringify({ error: "INVALID_RANGE" }), {
          status: 416,
          headers: {
            "Content-Type": "application/json",
            "Content-Range": `bytes */${Number(file.size)}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
      const rangeLimit = isRaw ? MAX_RAW_RANGE_BYTES : MAX_VIDEO_RANGE_BYTES;
      const requestedEnd = Math.min(parsed.end, parsed.start + rangeLimit - 1);
      const result = await telegramService.downloadFileRange(
        file.storageChannel.telegramChannelId,
        file.telegramMessageId,
        file.telegramFileId,
        file.telegramFileReference,
        parsed.start,
        requestedEnd,
        file.telegramAccessHash ?? undefined
      );
      bytes = result.bytes;
      refreshedReferenceB64 = result.refreshedReferenceB64;
      if (refreshedReferenceB64 && refreshedReferenceB64 !== file.telegramFileReference) {
        await db.file.update({
          where: { id: file.id },
          data: { telegramFileReference: refreshedReferenceB64 },
        });
      }
      const actualLength = bytes.length;
      return new Response(toStream(bytes), {
        status: 206,
        headers: {
          "Content-Type": file.mimeType,
          "Content-Length": String(actualLength),
          "Content-Range": `bytes ${parsed.start}-${parsed.start + actualLength - 1}/${Number(file.size)}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": `public, max-age=${PUBLIC_TTL}, immutable`,
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
          ...(file.sha256 ? { "ETag": `"${file.sha256}"` } : {}),
        },
      });
    }

    const result = await telegramService.downloadFile(
      file.storageChannel.telegramChannelId,
      file.telegramMessageId,
      file.telegramFileReference,
      file.telegramAccessHash ?? undefined
    );
    bytes = result.bytes;
    refreshedReferenceB64 = result.refreshedReferenceB64;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Telegram download failed", { err: msg, sequenceNumber: file.sequenceNumber });

    // If the message was deleted in Telegram, mark as missing
    if (msg.includes("MESSAGE_DELETED") || msg.includes("MESSAGE_ID_INVALID")) {
      await db.file.update({ where: { id: file.id }, data: { status: "missing" } });
      await cache.invalidate(publicId);
      return notFound();
    }

    return new Response(JSON.stringify({ error: "STORAGE_UNAVAILABLE" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Retry-After": "30" },
    });
  }

  // If fileReference was refreshed, persist new value
  if (refreshedReferenceB64 && refreshedReferenceB64 !== file.telegramFileReference) {
    try {
      await db.file.update({
        where: { id: file.id },
        data: { telegramFileReference: refreshedReferenceB64 },
      });
      logger.info("fileReference refreshed", { sequenceNumber: file.sequenceNumber });
    } catch (e) {
      logger.warn("failed to persist refreshed fileReference (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Compute sha256 if missing (used for ETag)
  let etag = file.sha256;
  if (!etag) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    etag = hash;
    // Persist lazily
    db.file.update({ where: { id: file.id }, data: { sha256: hash } }).catch((e) => {
      logger.warn("sha256 persist failed (non-fatal)", { err: e instanceof Error ? e.message : String(e) });
    });
  }

  // Warm cache only for non-video/audio assets. Caching an 800 MB video in the
  // application process/Redis defeats the bounded-range design.
  if (!isVideo && !isAudio) {
    await cache.setBytes(publicId, bytes);
  }
  await cache.setMeta(publicId, {
    mimeType: file.mimeType,
    size: bytes.length,
    status: "active",
    updatedAt: new Date().toISOString(),
  });

  // Update size if mismatch (Telegram may have transcoded)
  if (bytes.length !== Number(file.size)) {
    db.file.update({ where: { id: file.id }, data: { size: bytes.length } }).catch(() => {});
  }

  return serveBytes(bytes, file.mimeType, bytes.length, etag, supportsRange, rangeHeader);
}

function serveBytes(
  buf: Buffer,
  mimeType: string,
  size: number,
  etag: string | undefined,
  supportsRange: boolean,
  rangeHeader: string | null
): Response {
  const baseHeaders: Record<string, string> = {
    "Content-Type": mimeType,
    "Cache-Control": `public, max-age=${PUBLIC_TTL}, immutable`,
    "X-Content-Type-Options": "nosniff",
  };
  if (etag) baseHeaders["ETag"] = `"${etag}"`;
  if (supportsRange) baseHeaders["Accept-Ranges"] = "bytes";
  // Allow embedding from any origin so GrowPlants can <img>/<video src=...>
  baseHeaders["Access-Control-Allow-Origin"] = "*";

  if (!supportsRange || !rangeHeader) {
    return new Response(toStream(buf), {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    });
  }

  // HTTP Range support for range-capable media (video/audio/RAW preview reads)
  const parsed = parseRange(rangeHeader, size);
  if (!parsed) {
    return new Response(JSON.stringify({ error: "INVALID_RANGE" }), {
      status: 416,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }
  const { start, end } = parsed;
  const slice = buf.subarray(start, end + 1);
  return new Response(toStream(Buffer.from(slice)), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(slice.length),
    },
  });
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  let start: number;
  let end: number;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // suffix range: last N bytes
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (size <= 0 || start >= size || start < 0 || start > end) return null;
  // RFC 7233 permits an explicit end beyond the representation length; clamp
  // it to the last byte instead of incorrectly returning 416.
  end = Math.min(end, size - 1);
  return { start, end };
}

function toStream(buf: Buffer): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buf);
      controller.close();
    },
  });
}

export function notFound(): Response {
  return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `max-age=${NEGATIVE_TTL}`,
    },
  });
}
