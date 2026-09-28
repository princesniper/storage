/**
 * POST /api/channels/:id/test
 * Verifies that the connected Telegram account can access the configured
 * storage channel by sending and deleting a temporary test message.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { id } = await ctx.params;
  const channelId = Number(id);

  if (!Number.isInteger(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "INVALID_CHANNEL_ID" }, { status: 400 });
  }

  const channel = await db.storageChannel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const result = await telegramService.testChannel(channel.telegramChannelId);

    await audit({
      operation: "CHANNEL_TEST",
      status: result.ok ? "SUCCESS" : "FAILED",
      ip,
      metadata: {
        channelId: channel.id,
        name: channel.name,
        latencyMs: result.latencyMs,
        error: result.error ?? null,
      },
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        latencyMs: result.latencyMs,
        error: "CHANNEL_TEST_FAILED",
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    await audit({
      operation: "CHANNEL_TEST",
      status: "FAILED",
      ip,
      metadata: {
        channelId: channel.id,
        name: channel.name,
        error: detail,
      },
    });

    return NextResponse.json({
      ok: false,
      error: "CHANNEL_TEST_FAILED",
      detail: "Unable to complete the storage destination test.",
    }, { status: 502 });
  }
}
