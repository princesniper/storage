/**
 * GET /api/channels
 * POST /api/channels { name, destinationId, purpose? }
 *
 * The client never sends arbitrary channel IDs — only via this admin-only endpoint.
 * Upload endpoint accepts only the internal DB channel FK.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  await telegramService.ensureStarted();

  const channels = await db.storageChannel.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { files: true } } },
  });

  return NextResponse.json({
    destinations: channels.map((c) => ({
      id: c.id,
      name: c.name,
      telegramChannelId: c.telegramChannelId,
      destinationId: c.telegramChannelId,
      purpose: c.purpose,
      status: c.status,
      lastTestedAt: c.lastTestedAt,
      lastTestOk: c.lastTestOk,
      lastTestError: c.lastTestError,
      _count: { files: c._count.files },
    })),
    storageStatus: telegramService.getStatus(),
    telegramStatus: telegramService.getStatus(),
  });
}

const postBody = z.object({
  name: z.string().min(1).max(100),
  destinationId: z
    .string()
    .regex(/^-100\d{8,}$/, "Invalid storage destination identifier"),
  purpose: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  let parsed;
  try {
    parsed = postBody.parse(await req.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid";
    return NextResponse.json({ error: "INVALID_REQUEST", detail: msg }, { status: 400 });
  }

  await telegramService.ensureStarted();
  if (telegramService.getStatus() !== "connected") {
    return NextResponse.json({ error: "STORAGE_NOT_CONNECTED" }, { status: 400 });
  }

  // A channel may have been removed from the UI previously. Never create a
  // second record for the same Telegram channel: reactivate the existing
  // record so its File rows and Folder relationships become visible again.
  const existing = await db.storageChannel.findFirst({
    where: { telegramChannelId: parsed.destinationId },
  });

  // Existing records are intentionally idempotent. Reconnecting the same
  // Telegram channel must reuse its original database row rather than create
  // a new row and orphan the existing File/Folder index.
  // Verify access to the channel before reactivating/reusing it.
  const test = await telegramService.testChannel(parsed.destinationId);
  if (!test.ok) {
    return NextResponse.json(
      { error: "CHANNEL_ACCESS_FAILED", detail: "Unable to access the storage destination." },
      { status: 400 }
    );
  }

  // Find the TelegramAccount row (V1: single account)
  const acc = await db.telegramAccount.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!acc) {
    return NextResponse.json({ error: "NO_STORAGE_ACCOUNT" }, { status: 400 });
  }

  const channel = existing
    ? await db.storageChannel.update({
        where: { id: existing.id },
        data: {
          telegramAccountId: acc.id,
          name: parsed.name,
          purpose: parsed.purpose ?? existing.purpose,
          status: "active",
          lastTestedAt: new Date(),
          lastTestOk: true,
          lastTestLatencyMs: test.latencyMs,
          lastTestError: null,
        },
      })
    : await db.storageChannel.create({
        data: {
          telegramAccountId: acc.id,
          name: parsed.name,
          telegramChannelId: parsed.destinationId,
          purpose: parsed.purpose ?? null,
          status: "active",
          lastTestedAt: new Date(),
          lastTestOk: true,
          lastTestLatencyMs: test.latencyMs,
        },
      });

  await audit({
    operation: existing ? "CHANNEL_RECONNECT" : "CHANNEL_ADD",
    status: "SUCCESS",
    ip,
    metadata: {
      channelId: channel.id,
      name: channel.name,
      telegramChannelId: channel.telegramChannelId,
      restoredExistingData: Boolean(existing),
    },
  });

  return NextResponse.json({ channel }, { status: 201 });
}
