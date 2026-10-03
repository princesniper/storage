import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  search: z.string().max(200).optional().default(""),
  channelId: z.string().optional().default("all"),
  status: z.enum(["active", "deleted", "missing", "all"]).optional().default("active"),
  mimeType: z.string().max(100).optional().default("all"),
  minSize: z.coerce.number().int().min(0).optional(),
  maxSize: z.coerce.number().int().min(0).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  const q = parsed.data;
  const where: Record<string, unknown> = {};
  if (q.status !== "all") where.status = q.status;
  if (q.channelId !== "all") {
    const channelId = Number(q.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ error: "INVALID_CHANNEL" }, { status: 400 });
    where.storageChannelId = channelId;
  }
  if (q.search.trim()) where.OR = [{ originalName: { contains: q.search.trim() } }, { publicId: { contains: q.search.trim() } }];
  if (q.mimeType !== "all") where.mimeType = q.mimeType;
  if (q.minSize !== undefined || q.maxSize !== undefined) {
    if (q.minSize !== undefined && q.maxSize !== undefined && q.minSize > q.maxSize) return NextResponse.json({ error: "INVALID_SIZE_RANGE" }, { status: 400 });
    where.size = { ...(q.minSize !== undefined ? { gte: q.minSize } : {}), ...(q.maxSize !== undefined ? { lte: q.maxSize } : {}) };
  }
  if (q.from || q.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (q.from) { const d = new Date(q.from); if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "INVALID_FROM_DATE" }, { status: 400 }); range.gte = d; }
    if (q.to) { const d = new Date(q.to); if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "INVALID_TO_DATE" }, { status: 400 }); if (/^\\d{4}-\\d{2}-\\d{2}$/.test(q.to)) d.setUTCHours(23, 59, 59, 999); range.lte = d; }
    where.createdAt = range;
  }
  const total = await db.file.count({ where });
  const MAX_SELECTION = 5000;
  if (total > MAX_SELECTION) return NextResponse.json({ error: "SELECTION_TOO_LARGE", detail: "This result set contains more than 5,000 files. Narrow your filters and try again.", total, max: MAX_SELECTION }, { status: 413 });
  const rows = await db.file.findMany({ where, select: { id: true, status: true }, orderBy: { id: "asc" }, take: MAX_SELECTION });
  return NextResponse.json({ ids: rows.filter((f) => f.status === "active").map((f) => f.id), total, max: MAX_SELECTION });
}
