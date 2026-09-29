const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_DIMENSION = 4096;
const JPEG_QUALITY = 0.82;
const WEBP_QUALITY = 0.82;

interface WorkerRequest {
  id: number;
  file: File;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  blob?: Blob;
  error?: string;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file } = event.data;
  try {
    if (!IMAGE_MIME.has(file.type)) throw new Error("unsupported-image-format");
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: file.type !== "image/jpeg" });
    if (!context) throw new Error("canvas-unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const quality = file.type === "image/png" ? undefined : file.type === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY;
    const blob = await canvas.convertToBlob({ type: file.type, quality });
    if (!blob || blob.size <= 0) throw new Error("invalid-image-output");
    const response: WorkerResponse = { id, ok: true, blob };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : "image-compression-failed",
    } satisfies WorkerResponse);
  }
};
