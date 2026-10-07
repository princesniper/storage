import { compressionPolicy, shouldUseCompressedOutput } from "./compression-policy";
import type { CompressionMode, CompressionProgress, CompressionResult } from "./types";

type WorkerResult = { id: number; ok: boolean; blob?: Blob; error?: string };

class ImageWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

  private ensureWorker(): Worker {
    if (typeof Worker === "undefined") throw new Error("worker-unavailable");
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../../workers/compression.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const task = this.pending.get(event.data.id);
      if (!task) return;
      this.pending.delete(event.data.id);
      if (event.data.ok && event.data.blob) task.resolve(event.data.blob);
      else task.reject(new Error(event.data.error ?? "image-compression-failed"));
    };
    worker.onerror = () => {
      for (const task of this.pending.values()) task.reject(new Error("compression-worker-error"));
      this.pending.clear();
      worker.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  compress(file: File): Promise<Blob> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, file });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const task of this.pending.values()) task.reject(new Error("compression-worker-disposed"));
    this.pending.clear();
  }
}

const imageWorker = new ImageWorkerClient();

function fileFromBlob(blob: Blob, original: File): File {
  const type = blob.type || original.type;
  const name = original.name;
  return new File([blob], name, {
    type,
    lastModified: original.lastModified,
  });
}

async function compressImage(file: File): Promise<Blob> {
  return imageWorker.compress(file);
}

async function compressOne(
  file: File,
  mode: CompressionMode,
  onProgress?: (progress: CompressionProgress) => void,
): Promise<CompressionResult> {
  const originalSize = file.size;

  // PNGs are uploaded losslessly as-is. Browser OffscreenCanvas PNG
  // re-encoding is expensive and can stall/fail on large PNGs; it also
  // rarely produces a smaller file. Keep PNG uploads on the reliable
  // original-file path and reserve local compression for JPEG/WebP.
  if (file.type === "image/png") {
    return {
      originalFile: file,
      file,
      compressed: false,
      originalSize,
      outputSize: originalSize,
      savingsBytes: 0,
      savingsRatio: 0,
      mimeType: file.type,
      fallbackReason: "png-original-upload",
    };
  }

  const policy = compressionPolicy({ mode, size: originalSize });

  if (!policy.shouldAttempt) {
    return {
      originalFile: file,
      file,
      compressed: false,
      originalSize,
      outputSize: originalSize,
      savingsBytes: 0,
      savingsRatio: 0,
      mimeType: file.type,
      fallbackReason: policy.reason,
    };
  }

  onProgress?.({ state: "analyzing", detail: "Checking browser image compression support" });

  try {
    if (!file.type.startsWith("image/")) {
      throw new Error("unsupported-image-format");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("unsupported-image-format");
    }

    onProgress?.({ state: "compressing", detail: "Compressing image locally" });
    const blob = await compressImage(file);

    const worthwhile = shouldUseCompressedOutput(mode, originalSize, blob.size);
    if (!worthwhile) {
      return {
        originalFile: file,
        file,
        compressed: false,
        originalSize,
        outputSize: originalSize,
        savingsBytes: 0,
        savingsRatio: 0,
        mimeType: file.type,
        fallbackReason: blob.size >= originalSize ? "output-not-smaller" : "insignificant-savings",
      };
    }

    const output = fileFromBlob(blob, file);
    const savingsBytes = originalSize - output.size;
    const savingsRatio = savingsBytes / originalSize;
    onProgress?.({ state: "ready", progress: 100, detail: "Compressed image ready" });
    return {
      originalFile: file,
      file: output,
      compressed: true,
      originalSize,
      outputSize: output.size,
      savingsBytes,
      savingsRatio,
      mimeType: output.type,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "compression-failed";
    return {
      originalFile: file,
      file,
      compressed: false,
      originalSize,
      outputSize: originalSize,
      savingsBytes: 0,
      savingsRatio: 0,
      mimeType: file.type,
      fallbackReason: reason,
    };
  }
}
export async function compressFile(
  file: File,
  mode: CompressionMode,
  onProgress?: (progress: CompressionProgress) => void,
): Promise<CompressionResult> {
  const result = await compressOne(file, mode, onProgress);
  if (!result.compressed) {
    const detail = "Uploading original" + (result.fallbackReason ? " (" + result.fallbackReason + ")" : "");
    onProgress?.({ state: "fallback", progress: 100, detail });
  }
  return result;
}

export function disposeCompressionResources() {
  imageWorker.dispose();
}
