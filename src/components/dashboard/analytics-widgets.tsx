"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface Overview {
  channelBreakdown: {
    channelId: number;
    channelName: string;
    active: number;
    deleted: number;
    missing: number;
    total: number;
  }[];
  uploadActivity: { date: string; success: number; failed: number }[];
  mimeDistribution: { mime: string; count: number; pct: number }[];
  topFiles: {
    id: number;
    publicId: string;
    originalName: string;
    size: number;
    channelName: string;
    publicUrl: string;
  }[];
}

/**
 * Phase C — 5-color semantic charts only (no purple/pink decoration).
 * Completed/active/success = green · Missing = amber · Failed = red
 * Transit/processing accents = sky/teal · Deleted (soft, recoverable) = neutral.
 */
const C_ACTIVE = "#22c55e";
const C_DELETED = "#71717a";
const C_MISSING = "#f59e0b";
const C_SUCCESS = "#22c55e";
const C_FAILED = "#ef4444";
const MIME_COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#2dd4bf", "#ef4444"];

const TOOLTIP_STYLE = {
  background: "var(--background)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
} as const;

export function useAnalyticsOverview(days = 30) {
  return useQuery<Overview>({
    queryKey: ["analytics-overview", days],
    queryFn: async () => {
      const r = await fetch(`/api/analytics/overview?days=${days}`);
      if (!r.ok) throw new Error("Failed to load analytics");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Recharts doesn't read prefers-reduced-motion itself — pass it explicitly. */
function useChartAnimation(): boolean {
  const [animate] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  return animate;
}

function LoadingPair() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} tier="informational">
          <CardContent className="p-6">
            <div className="h-56 rounded-lg skeleton-shimmer" aria-label="Loading chart" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PanelsError() {
  return (
    <Card tier="informational">
      <CardContent className="p-6 text-sm text-muted-foreground text-center">
        Analytics unavailable. Try refreshing the page.
      </CardContent>
    </Card>
  );
}

/** Storage Overview: per-channel breakdown + media type mix (Tier 2). */
export function StorageOverview() {
  const { data, isLoading, isError } = useAnalyticsOverview();
  const animate = useChartAnimation();
  if (isLoading) return <LoadingPair />;
  if (isError || !data) return <PanelsError />;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <Card tier="informational" className="min-w-0 animate-page-enter" style={{ "--enter-delay": "120ms" } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="text-base">Storage by Channel</CardTitle>
        </CardHeader>
        <CardContent className="dashboard-chart-content h-72 min-w-0 text-muted-foreground">
          {data.channelBreakdown.length === 0 ? (
            <EmptyMsg />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.channelBreakdown} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fill: "currentColor", fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="channelName"
                  width={84}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                />
                <Tooltip contentStyle={{ ...TOOLTIP_STYLE }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="active" stackId="s" fill={C_ACTIVE} name="Active" isAnimationActive={animate} />
                <Bar dataKey="missing" stackId="s" fill={C_MISSING} name="Missing" isAnimationActive={animate} />
                <Bar dataKey="deleted" stackId="s" fill={C_DELETED} name="Deleted" isAnimationActive={animate} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card tier="informational" className="min-w-0 animate-page-enter" style={{ "--enter-delay": "160ms" } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="text-base">Media Type Mix</CardTitle>
        </CardHeader>
        <CardContent className="dashboard-pie-content min-w-0 text-muted-foreground">
          {data.mimeDistribution.length === 0 ? (
            <EmptyMsg />
          ) : (
            <>
              <div className="dashboard-pie-chart h-52 min-w-0 sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.mimeDistribution}
                      dataKey="count"
                      nameKey="mime"
                      innerRadius="55%"
                      outerRadius="82%"
                      paddingAngle={2}
                      isAnimationActive={animate}
                      label={false}
                      labelLine={false}
                    >
                      {data.mimeDistribution.map((entry, i) => (
                        <Cell key={entry.mime} fill={MIME_COLORS[i % MIME_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ ...TOOLTIP_STYLE }}
                      formatter={(value, name, item) => {
                        const pct =
                          (item as unknown as { payload?: { pct?: number } })?.payload?.pct ?? 0;
                        return [`${value} files (${pct}%)`, name];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="dashboard-pie-legend mt-3 grid min-w-0 grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                {data.mimeDistribution.map((entry, i) => (
                  <div key={entry.mime} className="flex min-w-0 items-start gap-2 text-xs">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: MIME_COLORS[i % MIME_COLORS.length] }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 break-words leading-4">{entry.mime}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                      {entry.pct}% · {entry.count}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Upload Activity: success/failed trend + largest files (Tier 2).
 *  Range switch offers only what GET /api/analytics/overview supports (days 1–90). */
const ACTIVITY_RANGES = [7, 30, 90] as const;

export function UploadActivity() {
  const { toast } = useToast();
  const [range, setRange] = useState<(typeof ACTIVITY_RANGES)[number]>(30);
  const { data, isLoading, isError } = useAnalyticsOverview(range);
  const animate = useChartAnimation();
  if (isLoading) return <LoadingPair />;
  if (isError || !data) return <PanelsError />;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <Card tier="informational" className="min-w-0 animate-page-enter" style={{ "--enter-delay": "200ms" } as React.CSSProperties}>
        <CardHeader className="flex flex-col items-start gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="min-w-0 text-base leading-snug">Upload Activity — Last {range} Days</CardTitle>
          <div className="flex shrink-0 gap-0.5 rounded-lg border border-border p-0.5" role="group" aria-label="Activity time range">
            {ACTIVITY_RANGES.map((d) => (
              <button
                key={d}
                onClick={() => setRange(d)}
                aria-pressed={range === d}
                className={
                  range === d
                    ? "h-11 min-w-11 rounded-md px-3 text-xs font-medium bg-secondary text-secondary-foreground sm:h-7 sm:min-w-0 sm:px-2.5"
                    : "h-11 min-w-11 rounded-md px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,color] sm:h-7 sm:min-w-0 sm:px-2.5"
                }
              >
                {d}D
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="dashboard-chart-content h-72 min-w-0 text-muted-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.uploadActivity} margin={{ left: -16, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="date"
                tick={{ fill: "currentColor", fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tick={{ fill: "currentColor", fontSize: 12 }} />
              <Tooltip contentStyle={{ ...TOOLTIP_STYLE }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="success" stroke={C_SUCCESS} strokeWidth={2} dot={false} name="Success" isAnimationActive={animate} />
              <Line type="monotone" dataKey="failed" stroke={C_FAILED} strokeWidth={2} dot={false} name="Failed" isAnimationActive={animate} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card tier="informational" className="animate-page-enter" style={{ "--enter-delay": "240ms" } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="text-base">Largest Files</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topFiles.length === 0 ? (
            <EmptyMsg />
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {data.topFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-sm py-1.5 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-xs" title={f.originalName}>
                      {f.originalName}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {formatBytes(f.size)} · {f.channelName}
                    </div>
                  </div>
                  <CopyButton
                    text={f.publicUrl}
                    iconOnly
                    label={`Copy media URL for ${f.originalName}`}
                    className="h-7 shrink-0"
                    onCopy={() => toast({ title: "Media URL copied" })}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Back-compat: full grid (unused by the redesigned dashboard, kept for safety). */
export default function AnalyticsWidgets() {
  return (
    <div className="space-y-4">
      <StorageOverview />
      <UploadActivity />
    </div>
  );
}

function EmptyMsg() {
  return <div className="h-full flex items-center justify-center text-sm">No data yet.</div>;
}

function shortMime(mime: string): string {
  const parts = mime.split("/");
  return parts.length > 1 ? parts[1].toUpperCase() : mime;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
