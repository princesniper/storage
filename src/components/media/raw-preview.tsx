"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

interface RawPreviewProps {
  src: string;
  alt?: string;
  className?: string;
  compact?: boolean;
  status?: string;
  error?: string | null;
}

export function RawPreview({ src, alt = "RAW photo", className, compact = false, status = "none", error }: RawPreviewProps) {
  const isReady = Boolean(status === "ready" && src);
  const label = status === "pending" || status === "processing"
    ? "GENERATING PREVIEW…"
    : status === "failed"
      ? "PREVIEW UNAVAILABLE"
      : "RAW";

  if (isReady) {
    return <img src={src} alt={alt} loading="lazy" className={cn("size-full object-cover", className)} />;
  }

  return (
    <div className={cn("size-full flex flex-col items-center justify-center gap-2 bg-muted/20", className)} title={error ?? undefined}>
      <Camera className={cn(compact ? "size-8" : "size-12", "text-muted-foreground/60")} aria-hidden />
      <span className="rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[9px] font-bold tracking-widest text-white/70">
        {label}
      </span>
    </div>
  );
}
