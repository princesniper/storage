"use client";

import type { ReactNode } from "react";
import { Film, Loader2 } from "lucide-react";

interface VideoThumbnailProps {
  src: string;
  alt: string;
  className?: string;
  fallback: ReactNode;
  previewUrl?: string | null;
  previewStatus?: string;
}

export function VideoThumbnail({
  src,
  alt,
  className,
  fallback,
  previewUrl,
  previewStatus = "none",
}: VideoThumbnailProps) {
  if (previewStatus === "ready" && previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={className}
      />
    );
  }

  if (previewStatus === "pending" || previewStatus === "processing") {
    return (
      <div className="relative flex size-full items-center justify-center overflow-hidden bg-muted/20">
        <div className="flex flex-col items-center gap-2 text-muted-foreground/70">
          <Loader2 className="size-7 animate-spin" aria-hidden />
          <span className="text-[9px] font-semibold tracking-widest">GENERATING THUMBNAIL…</span>
        </div>
      </div>
    );
  }

  if (previewStatus === "failed") {
    return (
      <div className="relative flex size-full items-center justify-center overflow-hidden bg-muted/20">
        <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
          <Film className="size-10" aria-hidden />
          <span className="text-[9px] font-semibold tracking-widest">THUMBNAIL UNAVAILABLE</span>
        </div>
      </div>
    );
  }

  return <>{fallback}</>;
}
