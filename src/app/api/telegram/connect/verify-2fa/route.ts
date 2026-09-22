/**
 * POST /api/telegram/connect/verify-2fa
 * Body: { password }
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { logger } from "@/lib/logger";
import { z } from "zod";

const body = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  let parsed;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    await telegramService.verify2fa(parsed.password);
    await audit({ operation: "TELEGRAM_CONNECT", status: "SUCCESS", ip, metadata: { step: "verify-2fa" } });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("telegram verify-2fa failed", { err: msg });
    await audit({ operation: "TELEGRAM_CONNECT", status: "FAILED", ip, errorMessage: msg });
    return NextResponse.json({ error: "VERIFY_2FA_FAILED", detail: msg }, { status: 400 });
  }
}
