import { cn } from "@/lib/utils"

/**
 * Phase E — shimmer-only skeleton (never stacked with pulse).
 * The sweep comes from `.skeleton-shimmer` in globals.css.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-lg", className)}
      {...props}
    />
  )
}

export { Skeleton }
