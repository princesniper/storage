export type ResumableUploadProgress = {
  stage: "browser" | "telegram" | "complete";
  progress: number;
  loadedBytes: number;
  speedBps: number;
  telegramProgress: number;
};

type Options = {
  file: File;
  storageChannelId: number;
  folderId?: number | null;
  relativePath?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: ResumableUploadProgress) => void;
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json.detail === "string" ? ` — ${json.detail}` : "";
    throw new Error(`${json.error || `HTTP_${response.status}`}${detail}`);
  }
  return json;
}

export async function resumableUpload(options: Options): Promise<{ url: string; duplicate?: false } | { url?: string; duplicate: true; message: string }> {
  const { file, storageChannelId, folderId = null, relativePath = null, signal, onProgress } = options;
  let loadedBytes = 0;

  const session = await jsonResponse(await fetch("/api/uploads/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storageChannelId,
      folderId,
      relativePath,
    }),
    signal,
  }));  const uploadId = String(session.uploadId);
  const chunkSize = Number(session.chunkSize);
  const totalChunks = Number(session.totalChunks);
  if (!uploadId || !Number.isInteger(chunkSize) || !Number.isInteger(totalChunks)) {
    throw new Error("INVALID_UPLOAD_SESSION");
  }

  const browserStartedAt = performance.now();
  for (let index = 0; index < totalChunks; index += 1) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch("/api/uploads/chunk", {
          method: "POST",
          headers: {
            "X-Upload-Id": uploadId,
            "X-Chunk-Index": String(index),
          },
          body: chunk,
          signal,
        });
        await jsonResponse(response);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }

    if (lastError) throw lastError;
    loadedBytes = end;
    const elapsed = Math.max((performance.now() - browserStartedAt) / 1000, 0.1);
    onProgress?.({
      stage: "browser",
      progress: Math.min(50, Math.round((loadedBytes / file.size) * 50)),
      loadedBytes,
      speedBps: loadedBytes / elapsed,
      telegramProgress: 0,
    });
  }

  await jsonResponse(await fetch("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
    signal,
  }));

  let previousTelegramBytes = 0;
  let previousTelegramAt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    await sleep(750);
    const response = await fetch(`/api/status?uploadId=${encodeURIComponent(uploadId)}`, {
      cache: "no-store",
      signal,
    });
    const json = await response.json().catch(() => ({}));
    const state = json.upload;
    if (!state) continue;
    if (state.stage === "duplicate") {
      return {
        duplicate: true,
        message: typeof state.error === "string" ? state.error : "Duplicate skipped.",
        ...(typeof state.fileUrl === "string" ? { url: state.fileUrl } : {}),
      };
    }

    const telegramProgress = Number(state.progress) || 0;
    const now = performance.now();
    const telegramLoadedBytes = Math.round(file.size * (telegramProgress / 100));
    const elapsedSinceSample = previousTelegramAt === 0 ? 0 : (now - previousTelegramAt) / 1000;
    const speedBps = elapsedSinceSample > 0
      ? Math.max(0, telegramLoadedBytes - previousTelegramBytes) / elapsedSinceSample
      : 0;
    previousTelegramBytes = telegramLoadedBytes;
    previousTelegramAt = now;
    onProgress?.({
      stage: state.stage === "complete" ? "complete" : "telegram",
      progress: state.stage === "complete" ? 100 : Math.min(99, 50 + Math.round(telegramProgress * 0.5)),
      loadedBytes: state.stage === "complete" ? file.size : telegramLoadedBytes,
      speedBps: state.stage === "complete" ? 0 : speedBps,
      telegramProgress,
    });

    if (state.stage === "complete" && typeof state.fileUrl === "string") {
      return { url: state.fileUrl };
    }
    if (state.stage === "failed") {
      throw new Error(typeof state.error === "string" ? state.error : "UPLOAD_FAILED");
    }
  }
}
