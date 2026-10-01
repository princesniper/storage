/**
 * GET /api/analytics/overview?days=30
 * Admin-only. Aggregated storage analytics for the dashboard.
 * Response cached in-memory for 5 minutes.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/services/rate-limit";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { canonicalUrl } from "@/lib/media-url";
import { z } from "zod";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});

interface Cached {
  data: unknown;
  expires: number;
  key: string;
}
let cacheEntry: Cached | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`analytics:${ip}`, 60, 60_000).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ days: url.searchParams.get("days") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }
  const { days } = parsed.data;
  const cacheKey = `days=${days}`;

  if (cacheEntry && cacheEntry.key === cacheKey && Date.now() < cacheEntry.expires) {
    return NextResponse.json(cacheEntry.data);
  }

  try {
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const [channels, statusGroups, mimeGroups, topFiles, uploadLogs] = await Promise.all([
      db.storageChannel.findMany({ select: { id: true, name: true } }),
      db.file.groupBy({
        by: ["storageChannelId", "status"],
        _count: { _all: true },
      }),
      db.file.groupBy({
        by: ["mimeType"],
        where: { status: "active" },
        _count: { _all: true },
      }),
      db.file.findMany({
        where: { status: "active" },
        orderBy: { size: "desc" },
        take: 10,
        select: {
          id: true,
          publicId: true,
          originalName: true,
          size: true,
          publicUrl: true,
          sequenceNumber: true,
          mimeType: true,
          storageChannel: { select: { name: true } },
        },
      }),
      db.uploadLog.findMany({
        where: { operation: "UPLOAD", createdAt: { gte: since } },
        select: { status: true, createdAt: true },
      }),
    ]);

    const channelNames = new Map(channels.map((c) => [c.id, c.name]));
    const channelBreakdown = channels.map((c) => {
      const groups = statusGroups.filter((g) => g.storageChannelId === c.id);
      const count = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
      const active = count("active");
      const deleted = count("deleted");
      const missing = count("missing");
      return {
        channelId: c.id,
        channelName: channelNames.get(c.id) ?? `Channel ${c.id}`,
        active,
        deleted,
        missing,
        total: active + deleted + missing,
      };
    });

    // Bucket upload logs by day (fill zeros for the full window)
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const buckets = new Map(dayKeys.map((k) => [k, { success: 0, failed: 0 }]));
    for (const l of uploadLogs) {
      const k = new Date(l.createdAt).toISOString().slice(0, 10);
      const b = buckets.get(k);
      if (!b) continue;
      if (l.status === "SUCCESS") b.success += 1;
      else b.failed += 1; // FAILED + PARTIAL both count as failed
    }
    const uploadActivity = dayKeys.map((date) => ({
      date,
      success: buckets.get(date)!.success,
      failed: buckets.get(date)!.failed,
    }));

    const totalActive = mimeGroups.reduce((s, g) => s + g._count._all, 0);
    const mimeDistribution = mimeGroups.map((g) => ({
      mime: g.mimeType,
      count: g._count._all,
      pct: totalActive > 0 ? Math.round((g._count._all / totalActive) * 1000) / 10 : 0,
    }));

    const data = {
      channelBreakdown,
      uploadActivity,
      mimeDistribution,
      topFiles: topFiles.map((f) => ({
        id: f.id,
        publicId: f.publicId,
        originalName: f.originalName,
        size: Number(f.size),
        channelName: f.storageChannel?.name ?? "—",
        publicUrl: f.sequenceNumber != null ? canonicalUrl(f.sequenceNumber, f.mimeType) : f.publicUrl,
      })),
    };

    cacheEntry = { data, expires: Date.now() + CACHE_MS, key: cacheKey };
    return NextResponse.json(data);
  } catch (e) {
    logger.error("analytics overview failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "ANALYTICS_FAILED" }, { status: 500 });
  }
}
