const VIDEO_MAX_DIMENSION = 1920;
const VIDEO_BITRATE = 4_000_000;
const AUDIO_BITRATE = 128_000;
const TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_MIME = "video/webm";
const OUTPUT_EXTENSION = "webm";

function waitForEvent(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      target.removeEventListener(event, done);
      reject(new Error("video-compression-timeout"));
    }, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, done);
      resolve();
    };
    target.addEventListener(event, done, { once: true });
  });
}

export async function compressVideo(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("media-recorder-unavailable");
  const captureStream = (HTMLVideoElement.prototype as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (!captureStream) throw new Error("capture-stream-unavailable");
  const recorderMime = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    OUTPUT_MIME,
  ].find((mime) => MediaRecorder.isTypeSupported(mime));
  if (!recorderMime) throw new Error("webm-recorder-unavailable");

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  let source: MediaStream | null = null;
  let output: MediaStream | null = null;
  try {
    await waitForEvent(video, "loadedmetadata", TIMEOUT_MS);
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new Error("invalid-video-metadata");
    }

    const scale = Math.min(1, VIDEO_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
    const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas-unavailable");

    const sourceStream = captureStream.call(video);
    source = sourceStream;
    const outputStream = canvas.captureStream(30);
    output = outputStream;
    for (const track of sourceStream.getAudioTracks()) outputStream.addTrack(track);

    const recorder = new MediaRecorder(output, {
      mimeType: recorderMime,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    const chunks: Blob[] = [];
    let recorderError: Error | null = null;
    const stopPromise = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      recorderError = new Error("video-encoder-error");
    });

    const duration = video.duration;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        try { if (recorder.state === "recording") recorder.stop(); } catch {}
        reject(new Error("video-compression-timeout"));
      }, TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
      };
      const finish = () => {
        cleanup();
        if (recorder.state === "recording") recorder.stop();
        resolve();
      };
      const onEnded = () => finish();
      const onError = () => {
        cleanup();
        try { if (recorder.state === "recording") recorder.stop(); } catch {}
        reject(new Error("video-decoding-error"));
      };
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onError, { once: true });

      recorder.start(1000);
      void video.play().then(() => {
        const drawFrame = () => {
          if (recorder.state !== "recording") return;
          context.drawImage(video, 0, 0, width, height);
          if (duration > 0) {
            const progress = Math.min(99, Math.round((video.currentTime / duration) * 100));
            onProgress?.(progress);
            if (video.ended || video.currentTime >= duration - 0.05) {
              finish();
              return;
            }
          }
          window.requestAnimationFrame(drawFrame);
        };
        drawFrame();
      }).catch(() => onError());
    });

    await stopPromise;
    if (recorderError) throw recorderError;
    onProgress?.(100);

    const blob = new Blob(chunks, { type: OUTPUT_MIME });
    if (blob.size <= 0) throw new Error("invalid-video-output");

    const validationUrl = URL.createObjectURL(blob);
    const validationVideo = document.createElement("video");
    validationVideo.preload = "metadata";
    validationVideo.src = validationUrl;
    try {
      await waitForEvent(validationVideo, "loadedmetadata", 15_000);
      if (!Number.isFinite(validationVideo.duration) || validationVideo.duration < duration * 0.95) {
        throw new Error("compressed-video-duration-mismatch");
      }
      const outputBitrate = (blob.size * 8) / validationVideo.duration;
      if (!Number.isFinite(outputBitrate) || outputBitrate < 256_000) {
        throw new Error("compressed-video-bitrate-too-low");
      }
      if (validationVideo.videoWidth < 2 || validationVideo.videoHeight < 2) {
        throw new Error("compressed-video-invalid-dimensions");
      }
    } finally {
      validationVideo.removeAttribute("src");
      validationVideo.load();
      URL.revokeObjectURL(validationUrl);
    }
    source.getTracks().forEach((track) => track.stop());
    outputStream.getTracks().forEach((track) => track.stop());
    return blob;
  } finally {
    source?.getTracks().forEach((track) => track.stop());
    output?.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(url);
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}
