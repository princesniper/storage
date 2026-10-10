/**
 * GET /api/analytics/overview?days=30
 * Admin-only. Aggregated storage analytics for the dashboard.
 * Response cached in-memory for 5 minutes.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { withNonRemovedStorageChannel } from "@/lib/active-library";
import { getCachedAnalytics, setCachedAnalytics } from "@/lib/analytics-cache";
import { rateLimitAsync } from "@/services/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { canonicalUrl } from "@/lib/media-url";
import { z } from "zod";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});

const CACHE_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = getClientIp(req.headers);
  if (!(await rateLimitAsync(`analytics:${ip}`, 60, 60_000)).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ days: url.searchParams.get("days") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }
  const { days } = parsed.data;

  try {
    // Include channel state in the key as a cross-route invalidation safeguard.
    // Even if Next.js bundles route modules separately, a status/label change
    // yields a fresh key and bypasses a cached overview for the old library.
    const channelState = await db.storageChannel.findMany({
      orderBy: { id: "asc" },
      select: { id: true, name: true, status: true, updatedAt: true },
    });
    const cacheKey = `days=${days};channels=${JSON.stringify(channelState.map((c) => [c.id, c.name, c.status, c.updatedAt.toISOString()]))}`;
    const cached = getCachedAnalytics(cacheKey);
    if (cached !== null) return NextResponse.json(cached, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    const channels = channelState.filter((channel) => channel.status !== "removed").map(({ id, name }) => ({ id, name }));

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const [statusGroups, mimeGroups, topFiles, uploadLogs] = await Promise.all([
      db.file.groupBy({
        by: ["storageChannelId", "status"],
        where: withNonRemovedStorageChannel({}),
        _count: { _all: true },
      }),
      db.file.groupBy({
        by: ["mimeType"],
        where: withNonRemovedStorageChannel({ status: "active" }),
        _count: { _all: true },
      }),
      db.file.findMany({
        where: withNonRemovedStorageChannel({ status: "active" }),
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
        where: {
          operation: "UPLOAD",
          createdAt: { gte: since },
          OR: [
            { fileId: null },
            { file: { is: { storageChannel: { is: { status: { not: "removed" } } } } } },
          ],
        },
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

    setCachedAnalytics(cacheKey, data, CACHE_MS);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (e) {
    logger.error("analytics overview failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "ANALYTICS_FAILED" }, { status: 500 });
  }
}
