/**
 * POST /api/telegram/disconnect
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  try {
    await telegramService.disconnect();
    await audit({ operation: "TELEGRAM_DISCONNECT", status: "SUCCESS", ip });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("telegram disconnect failed", { err: msg });
    await audit({ operation: "TELEGRAM_DISCONNECT", status: "FAILED", ip, errorMessage: msg });
    return NextResponse.json({ error: "DISCONNECT_FAILED", detail: msg }, { status: 500 });
  }
}
