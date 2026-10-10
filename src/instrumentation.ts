/**
 * Production-only Next.js instrumentation hook.
 *
 * Installs graceful shutdown and production media workers. These workers are
 * deliberately not imported or started in local development: a local test
 * session can use a different Telegram account than the production storage
 * channel, and should not run background jobs against a production inventory.
 */
export async function register() {
  // Keep heavy server-side media workers out of the local dev startup path.
  // They are required only by the deployed Node.js runtime.
  const runningOnProductionPlatform = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.FLY_APP_NAME,
  );
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || !runningOnProductionPlatform) {
    return;
  }

  const { initGracefulShutdown } = await import("./lib/shutdown");
  const { startDngPreviewWorker } = await import("./lib/dng-preview");
  const { startVideoThumbnailWorker } = await import("./lib/video-thumbnail");

  initGracefulShutdown();
  startDngPreviewWorker();
  startVideoThumbnailWorker();
}
