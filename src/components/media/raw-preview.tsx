"use client";

import { useEffect, useState } from "react";
import { Camera, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const PREVIEW_RANGE_BYTES = 16 * 1024 * 1024;

function findLargestJpeg(bytes: Uint8Array): Blob | null {
  let bestStart = -1;
  let bestEnd = -1;

  for (let i = 0; i + 1 < bytes.length; i += 1) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8) continue;
    let end = -1;
    for (let j = i + 2; j + 1 < bytes.length; j += 1) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
        end = j + 2;
        break;
      }
    }
    if (end > i && end - i > bestEnd - bestStart) {
      bestStart = i;
      bestEnd = end;
    }
    i = end > 0 ? end - 1 : i;
  }

  if (bestStart < 0 || bestEnd <= bestStart) return null;
  return new Blob([bytes.slice(bestStart, bestEnd)], { type: "image/jpeg" });
}

interface RawPreviewProps {
  src: string;
  alt?: string;
  className?: string;
  compact?: boolean;
}

export function RawPreview({ src, alt = "RAW photo", className, compact = false }: RawPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      try {
        setFailed(false);
        const response = await fetch(src, {
          headers: { Range: `bytes=0-${PREVIEW_RANGE_BYTES - 1}` },
          cache: "force-cache",
        });
        if (!response.ok && response.status !== 206) throw new Error(`RAW preview request failed: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const jpeg = findLargestJpeg(bytes);
        if (!jpeg) throw new Error("No embedded JPEG preview found");
        objectUrl = URL.createObjectURL(jpeg);
        if (!cancelled) setPreviewUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (previewUrl) {
    return <img src={previewUrl} alt={alt} className={cn("size-full object-cover", className)} />;
  }

  return (
    <div className={cn("size-full flex flex-col items-center justify-center gap-2 bg-muted/20", className)}>
      <Camera className={cn(compact ? "size-8" : "size-12", "text-muted-foreground/60")} aria-hidden />
      <span className="rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[9px] font-bold tracking-widest text-white/70">
        {failed ? "RAW" : "LOADING RAW"}
      </span>
    </div>
  );
}
