/**
 * POST /api/telegram/connect/request-code
 * Body: { phone: string }
 * Returns: { phoneCodeHash: string }
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { telegramService } from "@/services/telegram";
import { rateLimitAsync } from "@/services/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { audit } from "@/services/audit";
import { logger } from "@/lib/logger";
import { z } from "zod";

const body = z.object({ phone: z.string().min(5).max(20) });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = getClientIp(req.headers);
  if (!(await rateLimitAsync(`tg-code:${ip}`, 3, 60_000)).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  let parsed;
  try {
    parsed = body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  if (!env.TELEGRAM_API_ID || env.TELEGRAM_API_ID === 0 || env.TELEGRAM_API_HASH === "replace_me_with_real_api_hash") {
    return NextResponse.json(
      { error: "Telegram API credentials not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env" },
      { status: 503 }
    );
  }

  try {
    const result = await telegramService.requestCode(parsed.phone);
    await audit({ operation: "TELEGRAM_CONNECT", status: "SUCCESS", ip, metadata: { step: "request-code" } });
    return NextResponse.json({ phoneCodeHash: result.phoneCodeHash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("telegram request-code failed", { err: msg });
    await audit({ operation: "TELEGRAM_CONNECT", status: "FAILED", ip, errorMessage: msg });
    return NextResponse.json({ error: "TELEGRAM_REQUEST_FAILED", detail: msg }, { status: 502 });
  }
}
