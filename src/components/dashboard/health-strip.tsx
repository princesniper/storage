import { cn } from "@/lib/utils";
import { Wifi, Database, Cpu, Globe, WifiOff } from "lucide-react";

interface HealthItem {
  label: string;
  status: "ok" | "warning" | "error" | "unknown";
  detail?: string;
  icon: React.ElementType;
}

const STATUS_STYLES: Record<HealthItem["status"], string> = {
  ok: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  warning: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  error: "bg-red-500/10 border-red-500/20 text-red-400",
  unknown: "bg-white/[0.04] border-white/[0.08] text-muted-foreground",
};

const DOT_STYLES: Record<HealthItem["status"], string> = {
  ok: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]",
  warning: "bg-amber-400",
  error: "bg-red-400",
  unknown: "bg-muted-foreground/40",
};

const LABEL_STYLES: Record<HealthItem["status"], string> = {
  ok: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-red-400",
  unknown: "text-muted-foreground",
};

function HealthPill({ item }: { item: HealthItem }) {
  const Icon = item.icon;
  return (
    <div className={cn(
      "flex items-center gap-2.5 px-3.5 py-2 rounded-xl border transition-colors",
      STATUS_STYLES[item.status]
    )}>
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full shrink-0", DOT_STYLES[item.status])} aria-hidden />
          <span className="text-xs font-medium text-foreground/90">{item.label}</span>
        </div>
        {item.detail && (
          <span className={cn("text-[10px] font-medium mt-0.5 font-mono", LABEL_STYLES[item.status])}>
            {item.detail}
          </span>
        )}
      </div>
    </div>
  );
}

interface HealthStripProps {
  storageStatus: string;
  storageError?: string | null;
  cacheBackend: string;
  cacheEntries: number;
  redisKeys?: number;
}

export function HealthStrip({
  storageStatus,
  storageError,
  cacheBackend,
  cacheEntries,
  redisKeys,
}: HealthStripProps) {
  const statusTone: HealthItem["status"] =
    storageStatus === "connected"
      ? "ok"
      : storageStatus === "connecting" || storageStatus === "pending_2fa"
        ? "warning"
        : "error";

  const cacheDetail =
    cacheBackend === "redis"
      ? `Redis · ${redisKeys ?? cacheEntries} keys`
      : `In-memory · ${cacheEntries} entries`;

  const items: HealthItem[] = [
    {
      label: "Storage",
      status: statusTone,
      detail: statusTone === "ok" ? "Connected" : storageError ? "Offline" : storageStatus.replace("_", " "),
      icon: statusTone === "ok" ? Wifi : WifiOff,
    },
    {
      label: "Database",
      status: "ok",
      detail: "SQLite · Healthy",
      icon: Database,
    },
    {
      label: "Cache",
      status: "ok",
      detail: cacheDetail,
      icon: Cpu,
    },
    {
      label: "Public Delivery",
      status: "ok",
      detail: "m.media-growplants.com",
      icon: Globe,
    },
  ];

  return (
    <div className="flex flex-wrap gap-3" role="status" aria-label="System health">
      {items.map((item) => (
        <HealthPill key={item.label} item={item} />
      ))}
    </div>
  );
}
