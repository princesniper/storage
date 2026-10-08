/**
 * Graceful shutdown coordinator for the Next.js standalone server.
 *
 * Why this exists: the generated `.next/standalone/server.js` starts Node's
 * HTTP server but registers no SIGTERM/SIGINT handling, so Fly's shutdown
 * signal would kill in-flight uploads/downloads mid-request. This module —
 * installed from `src/instrumentation.ts register()` (same Node process,
 * before serving) — provides a real drain WITHOUT touching generated output:
 *
 *   1. On SIGTERM/SIGINT: find every live `net.Server` in this process and
 *      call `close()` → the kernel stops accepting NEW connections immediately.
 *   2. `closeIdleConnections()` drops idle keep-alive sockets so they can't
 *      hold the drain open; ACTIVE requests (uploads, Telegram downloads)
 *      keep running until they finish.
 *   3. Wait for all servers to report `close`, or until the drain budget
 *      expires (default 10s, always under Fly's 15s `kill_timeout`), then
 *      exit(0). A repeated signal exits immediately.
 *
 * Deliberately NOT done here:
 * - No `telegramService.disconnect()` — that WIPES the encrypted session
 *   from the database. The MTProto socket simply dies with the process;
 *   the persisted session is reused on next boot.
 * - No middleware cooperation — Next middleware runs in an isolated Edge
 *   runtime whose module state is NOT shared with this process, so an
 *   in-memory "draining" flag would be invisible there.
 * - No `server.closeAllConnections()` — that would abort in-flight work,
 *   the opposite of draining.
 */
import { logger } from "./logger";

const DEFAULT_DRAIN_MS = 10_000;
// Always leave margin under Fly's 15s kill_timeout so WE exit (code 0,
// "drain complete" logged) instead of being SIGKILLed mid-flush.
const MAX_DRAIN_MS = 13_000;

function drainBudgetMs(): number {
  const raw = Number(process.env.SHUTDOWN_DRAIN_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(Math.floor(raw), MAX_DRAIN_MS);
  return DEFAULT_DRAIN_MS;
}

type ClosableServer = {
  close: (cb?: (err?: Error) => void) => void;
  closeIdleConnections?: () => void;
};

function isServer(h: unknown): h is ClosableServer {
  return (
    typeof h === "object" &&
    h !== null &&
    typeof (h as ClosableServer).close === "function"
  );
}

/** All live TCP servers in this process (structural check — no `net` import needed). */
function liveServers(): ClosableServer[] {
  try {
    const handles =
      (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
    return handles.filter(isServer);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Core drain: stop accepting, drop idle keep-alives, wait for active
 * requests up to `timeoutMs`. Resolves `true` when everything closed
 * cleanly, `false` on timeout. No process exit — testable in isolation.
 */
export async function drainServers(timeoutMs: number): Promise<boolean> {
  const servers = liveServers();
  if (servers.length === 0) return true;
  const closed = await Promise.race([
    Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            try {
              // Idle keep-alive sockets must not hold the drain open.
              try {
                s.closeIdleConnections?.();
              } catch {
                /* older Node or already closing — non-fatal */
              }
              s.close(() => resolve());
            } catch {
              resolve(); // already closed/closing — treat as drained
            }
          })
      )
    ).then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
  return closed;
}

let installed = false;
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

async function beginShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    // Operator insists (e.g. second Ctrl+C / repeated SIGTERM): exit now.
    logger.warn("shutdown repeated, exiting immediately", { signal });
    process.exit(1);
  }
  shuttingDown = true;
  const { stopDngPreviewWorker } = await import("./dng-preview");
  await stopDngPreviewWorker();
  const budget = drainBudgetMs();
  logger.warn("shutdown signal received, draining active requests", { signal, budgetMs: budget });
  const clean = await drainServers(budget);
  logger.warn(clean ? "shutdown drain complete, exiting" : "shutdown drain timed out, exiting", {
    signal,
    clean,
  });
  process.exit(0);
}

/** Idempotent: safe to call once per process; no-ops everywhere except Node. */
export function initGracefulShutdown(): void {
  if (installed) return;
  installed = true;
  process.once("SIGTERM", () => void beginShutdown("SIGTERM"));
  process.once("SIGINT", () => void beginShutdown("SIGINT"));
}
