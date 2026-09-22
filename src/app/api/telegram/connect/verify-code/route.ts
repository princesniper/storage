/**
 * POST /api/telegram/connect/verify-code
 * Body: { phone, code, phoneCodeHash }
 * Returns: { needs2fa: boolean }
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { logger } from "@/lib/logger";
import { z } from "zod";

const body = z.object({
  phone: z.string().min(5).max(20),
  code: z.string().min(4).max(10),
  phoneCodeHash: z.string().min(10),
});

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
    const result = await telegramService.verifyCode(parsed.phone, parsed.code, parsed.phoneCodeHash);
    await audit({
      operation: "TELEGRAM_CONNECT",
      status: "SUCCESS",
      ip,
      metadata: { step: "verify-code", needs2fa: result.needs2fa },
    });
    return NextResponse.json({ needs2fa: result.needs2fa });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("telegram verify-code failed", { err: msg });
    await audit({ operation: "TELEGRAM_CONNECT", status: "FAILED", ip, errorMessage: msg });
    return NextResponse.json({ error: "VERIFY_FAILED", detail: msg }, { status: 400 });
  }
}
