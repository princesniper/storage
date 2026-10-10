/**
 * GET /api/channels/:id
 * PATCH /api/channels/:id { name?, purpose?, status? }
 * DELETE /api/channels/:id
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { invalidateAnalyticsCache } from "@/lib/analytics-cache";
import { audit } from "@/services/audit";
import { NextResponse } from "next/server";
import { z } from "zod";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await db.storageChannel.findUnique({ where: { id: Number(id) } });
  if (!ch || ch.status === "removed") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ channel: ch });
}

const patchBody = z.object({
  name: z.string().min(1).max(100).optional(),
  purpose: z.string().max(500).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { id } = await ctx.params;

  let parsed;
  try {
    parsed = patchBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "INVALID_REQUEST", detail: e instanceof Error ? e.message : "Invalid" }, { status: 400 });
  }

  const existing = await db.storageChannel.findUnique({ where: { id: Number(id) } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (existing.status === "removed") {
    return NextResponse.json({ error: "CHANNEL_REMOVED", detail: "Reconnect this channel through the authorized add-channel flow." }, { status: 409 });
  }

  const updated = await db.storageChannel.update({
    where: { id: existing.id },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.purpose !== undefined ? { purpose: parsed.purpose } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    },
  });

  invalidateAnalyticsCache();

  await audit({
    operation: "CHANNEL_UPDATE",
    status: "SUCCESS",
    ip,
    metadata: { channelId: updated.id, fields: Object.keys(parsed) },
  });

  return NextResponse.json({ channel: updated });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { id } = await ctx.params;

  const existing = await db.storageChannel.findUnique({ where: { id: Number(id) } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (existing.status === "removed") {
    invalidateAnalyticsCache();
    return NextResponse.json({ success: true, preserved: true, reconnectable: true, alreadyRemoved: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  // IMPORTANT: never hard-delete a storage channel.
  // Keep the original row and mark the registration as removed so it disappears
  // from the dashboard while a later POST can reactivate the same channel row.
  // File IDs, Telegram message mappings, folder hierarchy, sequences, previews,
  // and canonical public URLs remain untouched.
  const updated = await db.storageChannel.update({
    where: { id: existing.id },
    data: {
      status: "removed",
      lastTestOk: false,
      lastTestError: "Storage channel disconnected",
    },
  });

  invalidateAnalyticsCache();

  await audit({
    operation: "CHANNEL_DELETE",
    status: "SUCCESS",
    ip,
    metadata: {
      channelId: updated.id,
      name: updated.name,
      telegramChannelId: updated.telegramChannelId,
      action: "SOFT_REMOVE",
      dataPreserved: true,
    },
  });

  return NextResponse.json({
    success: true,
    preserved: true,
    reconnectable: true,
    channelId: updated.id,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
