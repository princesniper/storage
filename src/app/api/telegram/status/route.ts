/**
 * GET /api/telegram/status
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // Ensure the stored session has been loaded before reporting — otherwise
  // a fresh process always (wrongly) reports "disconnected".
  await telegramService.ensureStarted();
  return NextResponse.json({
    status: telegramService.getStatus(),
    lastError: telegramService.getLastError(),
  });
}
