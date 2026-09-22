/**
 * GET /api/health
 * Returns service status for monitoring / load balancer checks.
 * Never includes secrets.
 */
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";
import { cache } from "@/lib/cache";

export async function GET() {
  const out: { db: "ok" | "fail"; telegram: string; cache: string } = {
    db: "fail",
    telegram: "disconnected",
    cache: "memory",
  };
  try {
    await db.admin.count();
    out.db = "ok";
  } catch {
    out.db = "fail";
  }
  try {
    // Load the stored session first so a fresh process reports the real
    // state instead of the pre-boot "disconnected" default.
    await telegramService.ensureStarted();
    const st = telegramService.getStatus();
    out.telegram = st;
  } catch {
    out.telegram = "error";
  }
  try {
    out.cache = await cache.backend();
  } catch {
    out.cache = "memory";
  }
  const ok = out.db === "ok";
  return NextResponse.json(out, { status: ok ? 200 : 503 });
}
