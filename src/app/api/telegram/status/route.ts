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
  await telegramService.ensureStarted();
  const account = await (await import("@/lib/db")).db.telegramAccount.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  const hasStoredSession = Boolean(
    account?.sessionCipher && account.sessionIV && account.sessionAuthTag
  );
  const status = hasStoredSession && telegramService.getStatus() === "connected"
    ? "connected"
    : "disconnected";
  const connected = status === "connected";
  return NextResponse.json({
    status,
    connected,
    lastError: connected ? null : (telegramService.getLastError() ? "Unable to access storage." : null),
  }, { headers: { "Cache-Control": "no-store" } });
}
