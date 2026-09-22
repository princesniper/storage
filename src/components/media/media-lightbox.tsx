"use client";
import { useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isVideoMime } from "@/lib/format";
import type { MediaFile } from "./media-card";
import { MediaInspector } from "./media-inspector";

interface MediaLightboxProps {
  file: MediaFile | null;
  siblings?: number[];
  open: boolean;
  onClose: () => void;
  onNavigate?: (id: number) => void;
  onDeleted?: () => void;
}

export function MediaLightbox({ file, siblings = [], open, onClose, onNavigate, onDeleted }: MediaLightboxProps) {
  const currentIndex = file ? siblings.indexOf(file.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < siblings.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev && onNavigate) onNavigate(siblings[currentIndex - 1]);
  }, [hasPrev, onNavigate, siblings, currentIndex]);

  const goNext = useCallback(() => {
    if (hasNext && onNavigate) onNavigate(siblings[currentIndex + 1]);
  }, [hasNext, onNavigate, siblings, currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, goPrev, goNext]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open || !file) return null;

  const isVideo = isVideoMime(file.mimeType);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col md:flex-row",
        "bg-black/85 backdrop-blur-sm",
        "animate-in fade-in duration-[var(--duration-modal)]"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${file.originalName}`}
    >
      {/* Backdrop click to close */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />

      {/* ─── Left: Media viewer ─── */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center p-4 md:p-8 min-w-0">
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4 z-10 size-9 text-white/70 hover:text-white hover:bg-white/10"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X className="size-5" />
        </Button>

        {/* Prev arrow */}
        {hasPrev && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 z-10 size-10 text-white/70 hover:text-white hover:bg-white/10 rounded-full"
            onClick={goPrev}
            aria-label="Previous file"
          >
            <ChevronLeft className="size-6" />
          </Button>
        )}

        {/* Media */}
        <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {isVideo ? (
            <video
              key={file.id}
              src={file.publicUrl}
              controls
              className="max-w-full max-h-[80vh] rounded-xl shadow-2xl border border-white/[0.06]"
              style={{ background: "#0d0d0f" }}
            />
          ) : (
            <img
              key={file.id}
              src={file.publicUrl}
              alt={file.originalName}
              className="max-w-full max-h-[80vh] rounded-xl shadow-2xl border border-white/[0.06] object-contain"
              style={{ background: "#0d0d0f" }}
            />
          )}
        </div>

        {/* Next arrow */}
        {hasNext && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 z-10 size-10 text-white/70 hover:text-white hover:bg-white/10 rounded-full"
            onClick={goNext}
            aria-label="Next file"
          >
            <ChevronRight className="size-6" />
          </Button>
        )}

        {/* Keyboard hint */}
        {siblings.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[11px] text-white/40">
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] font-mono">←</kbd>
            <span>{currentIndex + 1} / {siblings.length}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] font-mono">→</kbd>
          </div>
        )}
      </div>

      {/* ─── Right: Inspector slide-over (bottom panel on mobile so no info disappears) ─── */}
      <div
        className="relative z-10 w-full shrink-0 flex flex-col border-t border-white/[0.08] bg-[#111113] overflow-y-auto max-h-[42%] md:max-h-none md:w-full md:max-w-xs md:border-t-0 md:border-l"
        onClick={(e) => e.stopPropagation()}
      >
        <MediaInspector
          file={file}
          onClose={onClose}
          onDeleted={() => { onDeleted?.(); onClose(); }}
        />
      </div>
    </div>
  );
}
