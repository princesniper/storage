import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Phase B — two card tiers (Quiet Premium, dense ops).
 * - Tier 1 "actionable": alerts, required actions, upload problems,
 *   storage warnings, operational controls. Stronger emphasis.
 * - Tier 2 "informational" (default): stats, secondary/historical
 *   content. Quieter. Existing usages render Tier 2 unless opted in,
 *   so no page visually breaks until Phases C/D opt in explicitly.
 */
export type CardTier = "actionable" | "informational";

export const cardTierClasses: Record<CardTier, string> = {
  actionable:
    "border-white/[0.12] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]",
  informational: "border-white/[0.07] shadow-sm",
};

function Card({
  className,
  tier = "informational",
  ...props
}: React.ComponentProps<"div"> & { tier?: CardTier }) {
  return (
    <div
      data-slot="card"
      data-tier={tier}
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6",
        cardTierClasses[tier],
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
