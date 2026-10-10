/**
 * Prevent a local app process from mutating the deployed database.
 *
 * A plain NODE_ENV=production is not enough to prove the code is running on
 * Railway/Fly: developers often run production builds locally. Remote URLs are
 * accepted only with a known deployment marker; loopback PostgreSQL is allowed
 * for local development and local production-build smoke tests.
 */
type RuntimeEnvironment = {
  NODE_ENV?: string;
  RAILWAY_ENVIRONMENT?: string;
  RAILWAY_PROJECT_ID?: string;
  RAILWAY_SERVICE_ID?: string;
  FLY_APP_NAME?: string;
};

export function assertSafeDatabaseTarget(
  databaseUrl: string | undefined,
  runtime: RuntimeEnvironment = process.env,
): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (loopbackHosts.has(hostname)) return;

  const runningOnKnownProductionPlatform =
    runtime.NODE_ENV === "production" &&
    (Boolean(runtime.RAILWAY_ENVIRONMENT || runtime.RAILWAY_PROJECT_ID || runtime.RAILWAY_SERVICE_ID) ||
      Boolean(runtime.FLY_APP_NAME));

  if (!runningOnKnownProductionPlatform) {
    throw new Error(
      "Blocked remote DATABASE_URL outside a recognized production deployment. Use local PostgreSQL for development; this prevents local channel actions from affecting production.",
    );
  }
}
