import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Meaningful empty state: icon + title + explanation + optional CTA.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-dashed border-border rounded-xl p-10 md:p-14 text-center bg-muted/30",
        className
      )}
    >
      <div className="size-12 rounded-xl bg-muted border border-border flex items-center justify-center mx-auto mb-4">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto text-pretty">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function EmptyAction({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button size="sm" {...props}>
      {children}
    </Button>
  );
}
