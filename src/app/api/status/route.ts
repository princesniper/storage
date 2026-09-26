/**
 * GET /api/status
 *
 * Public service-health endpoint (monitoring / dashboard / smoke tests).
 * Reflects the ACTUAL state — nothing is faked:
 *   - `database`: result of a live DB query.
 *   - `telegram`: live TelegramService state AFTER ensuring the stored
 *     session has been loaded (so a fresh process doesn't wrongly report
 *     "disconnected").
 *
 * Shape:
 *   { ok, database, telegram, telegramConnected, telegramError?, time }
 *
 * HTTP 200 when the database is reachable, 503 otherwise.
 * Never includes secrets.
 */
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { telegramService, getTelegramUploadProgress } from "@/services/telegram";

export async function GET(req: Request) {
  const uploadId = new URL(req.url).searchParams.get("uploadId");
  if (uploadId) {
    return NextResponse.json({ upload: getTelegramUploadProgress(uploadId) });
  }
  let database = false;
  try {
    await db.admin.count();
    database = true;
  } catch {
    database = false;
  }

  let telegram = "disconnected";
  let telegramError: string | null = null;
  try {
    await telegramService.ensureStarted();
    telegram = telegramService.getStatus();
    telegramError = telegramService.getLastError();
  } catch (e) {
    telegram = "error";
    telegramError = e instanceof Error ? e.message : String(e);
  }

  const telegramConnected = telegram === "connected";
  const ok = database;

  return NextResponse.json(
    {
      ok,
      database,
      telegram,
      telegramConnected,
      ...(telegramError ? { telegramError } : {}),
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
