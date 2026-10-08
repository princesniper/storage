/**
 * GET /api/telegram/status
 * Internal status endpoint. Provider details are abstracted from the UI.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // Do not reboot an already-authenticated in-memory client. During the
  // OTP flow (and in local development) the authenticated session may be
  // intentionally kept outside the production DB.
  if (telegramService.getStatus() !== "connected") {
    await telegramService.ensureStarted();
  }

  const status = telegramService.getStatus() === "connected"
    ? "connected"
    : "disconnected";
  const connected = status === "connected";
  return NextResponse.json({
    status,
    connected,
    lastError: connected ? null : (telegramService.getLastError() ? "Unable to access storage." : null),
  }, { headers: { "Cache-Control": "no-store" } });
}
