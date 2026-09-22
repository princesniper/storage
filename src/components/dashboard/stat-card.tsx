import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, type CardTier } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "@/components/dashboard/count-up";

/**
 * Phase C — Tier 2 informational stat card (Quiet Premium).
 * Count-up is opt-in for meaningful KPIs only (numeric totals).
 * Entire card links to `href` when provided.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  href,
  iconClassName,
  delay = 0,
  countUp = false,
  tier = "informational",
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  iconClassName?: string;
  delay?: number;
  countUp?: boolean;
  tier?: CardTier;
}) {
  const body = (
    <Card
      tier={tier}
      className="card-interactive animate-page-enter"
      style={{ "--enter-delay": `${delay}ms` } as React.CSSProperties}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className={cn("size-3.5", iconClassName)} aria-hidden />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums tracking-tight">
          {countUp && typeof value === "number" ? <CountUp value={value} /> : value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
  if (!href) return body;
  return (
    <Link
      href={href}
      className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      aria-label={`${label}: ${typeof value === "string" || typeof value === "number" ? value : ""}`}
    >
      {body}
    </Link>
  );
}
