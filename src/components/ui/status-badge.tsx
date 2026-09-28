import { cn } from "@/lib/utils";

/**
 * Phase B — 5-color semantic model only (Quiet Premium).
 * Waiting/Pending = amber · Processing/Confirmed = teal
 * Transit/Uploading/Moving = sky · Completed = green
 * Exception/Failed/Destructive = red.
 * `neutral` is kept for non-status quiet labels (e.g. soft-deleted,
 * inactive) — never for live operational status.
 * Legacy tones (success/error/warning/info) are aliases so existing
 * call sites keep rendering until Phases C/D migrate them.
 */
type Tone =
  | "waiting"
  | "processing"
  | "transit"
  | "completed"
  | "exception"
  | "neutral"
  | "success"
  | "error"
  | "warning"
  | "info";

const tones: Record<Tone, string> = {
  waiting: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  processing: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  transit: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  exception: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  // Legacy aliases → canonical 5-color mapping
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

/**
 * Pill status badge with icon-dot + label (never color-only: label always present).
 */
export function StatusBadge({
  tone,
  children,
  className,
  dot = true,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** File record status → tone mapping (5-color model). */
export function FileStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "active"
      ? "completed"
      : status === "deleted"
        ? "neutral"
        : status === "missing"
          ? "waiting"
          : "neutral";
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
}

/** Audit log status → tone mapping (5-color model). */
export function AuditStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "SUCCESS"
      ? "completed"
      : status === "FAILED"
        ? "exception"
        : "waiting";
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
}

/** Telegram connection status → tone mapping (5-color model). */
export function StorageStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "connected"
      ? "completed"
      : status === "connecting" || status === "pending_2fa"
        ? "waiting"
        : "neutral";
  return <StatusBadge tone={tone}>{status.replace("_", " ")}</StatusBadge>;
}
