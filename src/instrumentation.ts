/**
 * Next.js instrumentation hook — runs once in the Node.js server process
 * at boot, before the standalone server starts accepting traffic.
 *
 * Single responsibility: install the graceful-shutdown drain
 * (see src/lib/shutdown.ts) so Fly's SIGTERM/SIGINT lets in-flight
 * uploads/downloads finish instead of killing them mid-request.
 *
 * - Guarded to the nodejs runtime (this hook never runs useful work on Edge).
 * - Dynamic import keeps node-only code out of any Edge bundle.
 * - No Telegram, DB, or cache work here — connection stays lazy as designed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initGracefulShutdown } = await import("./lib/shutdown");
    const { startDngPreviewWorker } = await import("./lib/dng-preview");
    const { startVideoThumbnailWorker } = await import("./lib/video-thumbnail");
    initGracefulShutdown();
    startDngPreviewWorker();
    startVideoThumbnailWorker();
  }
}
