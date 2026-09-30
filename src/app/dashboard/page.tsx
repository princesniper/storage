import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramService } from "@/services/telegram";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { HealthStrip } from "@/components/dashboard/health-strip";
import { PageHeader } from "@/components/ui/page-header";
import { cache } from "@/lib/cache";
import { formatBytes, formatDate, formatDateTime, isVideoMime } from "@/lib/format";
import {
  CANONICAL_MEDIA_ORIGIN,
  canonicalUrl,
  formatSequence,
} from "@/lib/media-url";
import {
  Image as ImageIcon,
  FolderTree,
  Activity,
  Upload,
  ArrowRight,
  CheckCircle2,
  Film,
  CalendarDays,
  TriangleAlert,
  WifiOff,
  FileWarning,
  Database,
  Globe,
  ListOrdered,
  LayoutGrid,
} from "lucide-react";
import { StorageOverview, UploadActivity } from "@/components/dashboard/analytics-widgets";
import { FileStatusBadge, AuditStatusBadge, StorageStatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * Phase C — dashboard hierarchy (Quiet Premium, ops-first):
 * Page Header → Primary KPIs → Actionable Issues → Storage Overview
 * → Upload Activity → Recent Media / Activity.
 * Tier 1 cards render ONLY for genuinely actionable issues; everything
 * else is Tier 2. Count-up only on primary KPI totals.
 */
export default async function DashboardPage() {
  await getServerSession(authOptions);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalFiles,
    activeFiles,
    activeChannels,
    totalBytes,
    recentFiles,
    recentLogs,
    uploadsLast30,
    // ── Operational storage checks ──
    missingFiles,
    deletedFiles,
    latestSequence,
    channels,
  ] = await Promise.all([
    db.file.count(),
    db.file.count({ where: { status: "active" } }),
    db.storageChannel.count({ where: { status: "active" } }),
    db.file.aggregate({ _sum: { size: true }, where: { status: "active" } }),
    db.file.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: { storageChannel: true },
    }),
    db.uploadLog.findMany({ take: 6, orderBy: { createdAt: "desc" } }),
    db.file.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    db.file.count({ where: { status: "missing" } }),
    db.file.count({ where: { status: "deleted" } }),
    db.file.aggregate({ _max: { sequenceNumber: true } }),
    db.storageChannel.findMany({
      select: { id: true, name: true, status: true, lastTestOk: true, lastTestedAt: true },
      orderBy: { id: "asc" },
    }),
  ]);

  await telegramService.ensureStarted();
  const storageStatus = telegramService.getStatus();
  const storageError = telegramService.getLastError();
  const cacheStats = await cache.stats();
  const storageConnected = storageStatus === "connected";

  const failedTestChannels = channels.filter((c) => c.lastTestOk === false);
  const inactiveChannels = channels.filter((c) => c.status !== "active");
  const latestSeq = latestSequence._max.sequenceNumber ?? null;

  const issues: {
    icon: React.ElementType;
    title: string;
    detail: string;
    href: string;
    action: string;
  }[] = [];
  if (!storageConnected) {
    issues.push({
      icon: WifiOff,
      title: "Storage disconnected",
      detail: "Storage is unavailable. Uploads and media serving may be degraded.",
      href: "/settings",
      action: "Open settings",
    });
  }
  if (missingFiles > 0) {
    issues.push({
      icon: FileWarning,
      title: `${missingFiles.toLocaleString()} file${missingFiles === 1 ? "" : "s"} missing from storage`,
      detail: "Messages were deleted or became unreachable. Public URLs return 404.",
      href: "/files",
      action: "Open library",
    });
  }
  if (failedTestChannels.length > 0) {
    issues.push({
      icon: TriangleAlert,
      title: `${failedTestChannels.length} channel${failedTestChannels.length === 1 ? "" : "s"} failed last test`,
      detail: failedTestChannels.map((c) => c.name).slice(0, 3).join(", "),
      href: "/channels",
      action: "Check channels",
    });
  }

  const statusLine = !storageConnected
    ? "Infrastructure attention required — see action items below."
    : issues.length > 0
      ? `${issues.length} operational issue${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} attention.`
      : "Your media infrastructure is healthy and operational.";

  return (
    <DashboardShell>
      <div className="space-y-8">
        {/* ─── 1. Page Header ─── */}
        <PageHeader
          title="Dashboard"
          description={statusLine}
          actions={
            <>
              <Button size="sm" variant="outline" asChild>
                <a href="/files">
                  View files <ArrowRight className="size-3.5 ml-1" aria-hidden />
                </a>
              </Button>
              <Button size="sm" asChild>
                <a href="/upload">
                  <Upload className="size-3.5 mr-1" aria-hidden /> Upload
                </a>
              </Button>
            </>
          }
        />

        {/* ─── 2. Primary KPIs (Tier 2, count-up on totals) ─── */}
        <section aria-label="Primary metrics">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={ImageIcon}
              label="Total Files"
              value={totalFiles}
              countUp
              sub={`${formatBytes(Number(totalBytes._sum.size ?? 0))} stored`}
              href="/files"
              delay={40}
            />
            <StatCard
              icon={CheckCircle2}
              label="Active Files"
              value={activeFiles}
              countUp
              sub={totalFiles > 0 ? `${Math.round((activeFiles / totalFiles) * 100)}% of all files` : "No files yet"}
              href="/files?status=active"
              iconClassName="text-emerald-500"
              delay={80}
            />
            <StatCard
              icon={FolderTree}
              label="Active Channels"
              value={activeChannels}
              countUp
              sub={storageConnected ? "Storage connected" : `Storage ${storageStatus.replace("_", " ")}`}
              href="/channels"
              delay={120}
            />
            <StatCard
              icon={CalendarDays}
              label="Uploads (30d)"
              value={uploadsLast30}
              countUp
              sub={deletedFiles > 0 ? `${deletedFiles.toLocaleString()} deleted (numbers stay consumed)` : "In the last 30 days"}
              delay={160}
            />
          </div>
        </section>

        {/* ─── 3. Actionable Issues (Tier 1 only when action is needed) ─── */}
        <section aria-label="Action required">
          <SectionLabel>Action Required</SectionLabel>
          {issues.length === 0 ? (
            <Card tier="informational" className="animate-page-enter">
              <CardContent className="py-5 flex items-center gap-3">
                <span className="size-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">No action required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Storage connected · no missing files · all channel tests passing.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {issues.map((issue, i) => (
                <Card
                  key={issue.title}
                  tier="actionable"
                  className="animate-page-enter"
                  style={{ "--enter-delay": `${Math.min(i, 4) * 40}ms` } as React.CSSProperties}
                >
                  <CardContent className="py-5 flex items-start gap-3">
                    <span className="size-9 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <issue.icon className="size-4 text-red-400" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{issue.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 break-words">{issue.detail}</p>
                      <Button size="sm" variant="outline" className="mt-3" asChild>
                        <a href={issue.href}>
                          {issue.action} <ArrowRight className="size-3.5 ml-1" aria-hidden />
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ─── 4. Storage Overview (Tier 2) ─── */}
        <section aria-label="Storage overview" className="space-y-4">
          <SectionLabel>Storage Overview</SectionLabel>
          <div className="animate-page-enter" style={{ "--enter-delay": "60ms" } as React.CSSProperties}>
            <HealthStrip
              storageStatus={storageStatus}
              storageError={storageError}
              cacheBackend={cacheStats.backend}
              cacheEntries={cacheStats.bytesSize}
              redisKeys={cacheStats.redisKeys}
            />
          </div>
          <StorageOverview />

          <div className="grid gap-4 md:grid-cols-2">
            {/* storage */}
            <Card tier="informational" className="animate-page-enter">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="size-4 text-muted-foreground" aria-hidden />
                  Storage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="text-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Connection</dt>
                    <dd><StorageStatusBadge status={storageStatus} /></dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Channels</dt>
                    <dd className="tabular-nums font-medium">
                      {activeChannels} active · {channels.length} total
                      {inactiveChannels.length > 0 && (
                        <span className="text-muted-foreground"> ({inactiveChannels.length} inactive)</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Channel tests</dt>
                    <dd className="tabular-nums font-medium">
                      {failedTestChannels.length === 0 ? (
                        <span className="text-emerald-400">All passing</span>
                      ) : (
                        <span className="text-amber-400">{failedTestChannels.length} failing</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Missing files</dt>
                    <dd className="tabular-nums font-medium">{missingFiles.toLocaleString()}</dd>
                  </div>
                </dl>
                <Button size="sm" variant="outline" className="mt-4 w-full" asChild>
                  <a href="/channels">
                    Manage channels <ArrowRight className="size-3.5 ml-1" aria-hidden />
                  </a>
                </Button>
              </CardContent>
            </Card>

            {/* Media system */}
            <Card tier="informational" className="animate-page-enter" style={{ "--enter-delay": "80ms" } as React.CSSProperties}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" aria-hidden />
                  Media System
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="text-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground flex items-center gap-1">
                      <ListOrdered className="size-3" aria-hidden /> Latest sequence
                    </dt>
                    <dd className="font-mono tabular-nums font-medium">
                      {latestSeq != null ? `#${formatSequence(latestSeq)}` : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Canonical origin</dt>
                    <dd className="font-mono text-[11px]">{CANONICAL_MEDIA_ORIGIN}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Delivery cache</dt>
                    <dd className="tabular-nums">
                      {cacheStats.backend === "redis" ? `Redis · ${cacheStats.redisKeys ?? cacheStats.bytesSize} keys` : `In-memory · ${cacheStats.bytesSize} entries`}
                    </dd>
                  </div>
                </dl>
                {latestSeq != null && recentFiles[0] && (
                  <div className="mt-4 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">
                      Latest canonical URL
                    </div>
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 text-[11px] px-2 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg font-mono truncate">
                        {canonicalUrl(recentFiles[0].sequenceNumber ?? latestSeq, recentFiles[0].mimeType)}
                      </code>
                      <CopyButton
                        text={canonicalUrl(recentFiles[0].sequenceNumber ?? latestSeq, recentFiles[0].mimeType)}
                        iconOnly
                        label="Copy canonical URL"
                        className="size-8 shrink-0"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ─── 5. Upload / Processing Activity (Tier 2) ─── */}
        <section aria-label="Upload activity" className="space-y-4">
          <SectionLabel>Upload Activity</SectionLabel>
          <UploadActivity />
        </section>

        {/* ─── 6. Recent Media + Activity (Tier 2) ─── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card tier="informational" className="animate-page-enter" style={{ "--enter-delay": "260ms" } as React.CSSProperties}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="size-4 text-muted-foreground" aria-hidden />
                Recent Media
              </CardTitle>
              {recentFiles.length > 0 && (
                <Button size="sm" variant="ghost" asChild>
                  <a href="/files">
                    View all <ArrowRight className="size-3.5 ml-1" aria-hidden />
                  </a>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {recentFiles.length === 0 ? (
                <EmptyState
                  icon={ImageIcon}
                  title="No files uploaded yet"
                  description="Upload your first image or video to storage."
                  action={
                    <Button size="sm" asChild>
                      <a href="/upload">
                        <Upload className="size-3.5 mr-1" aria-hidden /> Upload
                      </a>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recentFiles.map((f) => (
                    <li key={f.id}>
                      <a
                        href={`/files?search=${encodeURIComponent(f.publicId)}`}
                        className="flex items-center gap-3 py-2.5 rounded-lg transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.03] px-2 -mx-2"
                      >
                        <span className="size-11 rounded-lg overflow-hidden bg-muted/40 shrink-0 flex items-center justify-center border border-white/[0.06]">
                          {isVideoMime(f.mimeType) ? (
                            <Film className="size-5 text-muted-foreground" aria-hidden />
                          ) : (
                            <img
                              src={f.publicUrl}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          )}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate">{f.originalName}</span>
                          <span className="block text-xs text-muted-foreground truncate tabular-nums">
                            {f.sequenceNumber != null && (
                              <span className="font-mono">#{formatSequence(f.sequenceNumber)} · </span>
                            )}
                            {f.storageChannel?.name} · {formatBytes(Number(f.size))}
                          </span>
                        </span>
                        <span className="hidden sm:block text-xs text-muted-foreground shrink-0 tabular-nums">
                          {formatDate(f.createdAt)}
                        </span>
                        <FileStatusBadge status={f.status} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card tier="informational" className="animate-page-enter" style={{ "--enter-delay": "300ms" } as React.CSSProperties}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" aria-hidden />
                  Live Activity
                </CardTitle>
                <Button size="sm" variant="ghost" asChild>
                  <a href="/audit">
                    Audit log <ArrowRight className="size-3.5 ml-1" aria-hidden />
                  </a>
                </Button>
              </CardHeader>
              <CardContent>
                {recentLogs.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">No recent activity.</div>
                ) : (
                  <ul className="space-y-1">
                    {recentLogs.map((l) => (
                      <li key={l.id} className="flex items-center gap-2.5 text-sm py-1.5">
                        <AuditStatusBadge status={l.status} />
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] shrink-0">
                          {l.operation}
                        </span>
                        <span className="text-muted-foreground text-xs shrink-0 hidden sm:inline tabular-nums">
                          {formatDateTime(l.createdAt)}
                        </span>
                        {l.errorMessage && (
                          <span className="text-xs text-muted-foreground truncate flex-1">— {l.errorMessage}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Quick actions — real routes only */}
            <Card tier="informational" className="animate-page-enter" style={{ "--enter-delay": "320ms" } as React.CSSProperties}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <a href="/upload"><Upload className="size-3.5 mr-1" aria-hidden /> Upload media</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/files">Browse library</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/channels">Storage channels</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/audit">Audit log</a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/60 uppercase mb-3">
      {children}
    </p>
  );
}
