"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, MoreVertical, RotateCw, AlertTriangle } from "lucide-react";
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

type Point = { x: number; y: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const SWIPE_DISTANCE = 64;
const SWIPE_VERTICAL_TOLERANCE = 100;

export function MediaLightbox({
  file,
  siblings = [],
  open,
  onClose,
  onNavigate,
  onDeleted,
}: MediaLightboxProps) {
  const currentIndex = file ? siblings.indexOf(file.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < siblings.length - 1;
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const dragStart = useRef<{ point: Point; pan: Point } | null>(null);
  const swipeStart = useRef<Point | null>(null);
  const videoTouchStart = useRef<Point | null>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    pinchStart.current = null;
    dragStart.current = null;
    swipeStart.current = null;
    pointers.current.clear();
  }, []);

  const goPrev = useCallback(() => {
    if (hasPrev && onNavigate) onNavigate(siblings[currentIndex - 1]);
  }, [hasPrev, onNavigate, siblings, currentIndex]);

  const goNext = useCallback(() => {
    if (hasNext && onNavigate) onNavigate(siblings[currentIndex + 1]);
  }, [hasNext, onNavigate, siblings, currentIndex]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetView();
    setIsInspectorOpen(false);
    setMediaError(false);
  }, [file?.id, file?.mimeType, open, resetView]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isInspectorOpen) setIsInspectorOpen(false);
        else onClose();
      } else if (event.key === "ArrowLeft") {
        goPrev();
      } else if (event.key === "ArrowRight") {
        goNext();
      } else if (event.key === "0") {
        resetView();
      } else if (event.key === "r" || event.key === "R") {
        setRotation((value) => (value + 90) % 360);
      } else if (event.key === "+" || event.key === "=") {
        setZoom((value) => Math.min(MAX_ZOOM, value + 0.25));
      } else if (event.key === "-") {
        setZoom((value) => Math.max(MIN_ZOOM, value - 0.25));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, isInspectorOpen, onClose, goPrev, goNext, resetView]);

  useEffect(() => {
    if (!open) {
      pointers.current.clear();
      pinchStart.current = null;
      dragStart.current = null;
      swipeStart.current = null;
      videoTouchStart.current = null;
    }
  }, [open]);

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "touch" && event.pointerType !== "pen") return;

    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointers.current.size === 1) {
      swipeStart.current = point;
      if (zoom > 1) dragStart.current = { point, pan };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { distance: distance(a, b), zoom };
      dragStart.current = null;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.has(event.pointerId)) return;

    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const start = pinchStart.current;
      const ratio = distance(a, b) / Math.max(start.distance, 1);
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.zoom * ratio)));
      return;
    }

    if (pointers.current.size === 1 && zoom > 1 && dragStart.current) {
      setPan({
        x: dragStart.current.pan.x + point.x - dragStart.current.point.x,
        y: dragStart.current.pan.y + point.y - dragStart.current.point.y,
      });
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLImageElement>) => {
    const start = swipeStart.current;
    const end = { x: event.clientX, y: event.clientY };

    pointers.current.delete(event.pointerId);

    if (pointers.current.size === 0) {
      dragStart.current = null;
      swipeStart.current = null;

      const dx = end.x - (start?.x ?? end.x);
      const dy = end.y - (start?.y ?? end.y);

      if (
        zoom === 1 &&
        start &&
        Math.abs(dx) >= SWIPE_DISTANCE &&
        Math.abs(dy) <= SWIPE_VERTICAL_TOLERANCE
      ) {
        if (dx > 0) goPrev();
        else goNext();
      }
    }

    if (pointers.current.size < 2) pinchStart.current = null;
  };

  const handleImageDoubleClick = () => {
    if (zoom > 1) resetView();
    else setZoom(2);
  };

  const handleImageWheel = (event: React.WheelEvent<HTMLImageElement>) => {
    event.preventDefault();
    setZoom((value) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + (event.deltaY < 0 ? 0.2 : -0.2)))
    );
  };

  const rotate = () => setRotation((value) => (value + 90) % 360);

  const handleVideoTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    videoTouchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleVideoTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = videoTouchStart.current;
    videoTouchStart.current = null;
    if (!start || !isVideo) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dy) <= SWIPE_VERTICAL_TOLERANCE) {
      if (dx > 0) goPrev();
      else goNext();
    }
  };

  if (!mounted || !open || !file) return null;

  const isVideo = isVideoMime(file.mimeType);
  const mediaFitClass = rotation % 180 === 0
    ? "max-w-[min(92vw,1200px)] max-h-[min(82dvh,900px)]"
    : "max-w-[min(82dvh,900px)] max-h-[min(92vw,1200px)]";

  return createPortal(
    (
      <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md animate-in fade-in duration-[var(--duration-modal)]"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${file.originalName}`}
    >
      <div className="absolute inset-0 z-0 bg-black/70" onClick={onClose} aria-hidden />

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-16 sm:px-6 sm:py-14">
        <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 max-w-[min(70vw,520px)] rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-center shadow-xl backdrop-blur-xl sm:top-4">
          <div className="truncate text-xs font-semibold text-white/95">{file.originalName}</div>
          <div className="mt-0.5 text-[10px] text-white/55">
            {file.sequenceNumber !== null ? `#${String(file.sequenceNumber).padStart(6, "0")} · ` : ""}
            {file.mimeType} · {Math.round((file.size / 1024 / 1024) * 10) / 10} MB
          </div>
        </div>

        <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 sm:right-4 sm:top-4">
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-10 rounded-xl border border-white/10 bg-black/55 text-white/80 shadow-lg backdrop-blur-xl hover:bg-white/10 hover:text-white",
                isInspectorOpen && "bg-white/15 text-white"
              )}
              onClick={(event) => {
                event.stopPropagation();
                setIsInspectorOpen((value) => !value);
              }}
              aria-label="Open file inspector and actions"
              aria-expanded={isInspectorOpen}
            >
              <MoreVertical className="size-5" />
            </Button>

            {isInspectorOpen && (
              <div
                className="absolute right-0 top-12 z-50 max-h-[calc(100dvh-5rem)] w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#111113]/[98%] shadow-2xl shadow-black/60 backdrop-blur-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <MediaInspector
                  file={file}
                  onClose={() => setIsInspectorOpen(false)}
                  onDeleted={() => {
                    onDeleted?.();
                    onClose();
                  }}
                />
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-xl border border-white/10 bg-black/55 text-white/80 shadow-lg backdrop-blur-xl hover:bg-white/10 hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="Close preview"
          >
            <X className="size-5" />
          </Button>
        </div>

        {siblings.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 z-30 size-11 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 text-white shadow-xl backdrop-blur-xl hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30 sm:left-5"
              onClick={(event) => {
                event.stopPropagation();
                goPrev();
              }}
              disabled={!hasPrev}
              aria-label="Previous file"
            >
              <ChevronLeft className="size-6" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 z-30 size-11 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 text-white shadow-xl backdrop-blur-xl hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30 sm:right-5"
              onClick={(event) => {
                event.stopPropagation();
                goNext();
              }}
              disabled={!hasNext}
              aria-label="Next file"
            >
              <ChevronRight className="size-6" />
            </Button>
          </>
        )}

        <div
          className={cn(
            "relative flex h-full w-full items-center justify-center",
            isVideo && "touch-pan-y"
          )}
          onClick={(event) => event.stopPropagation()}
          onTouchStart={isVideo ? handleVideoTouchStart : undefined}
          onTouchEnd={isVideo ? handleVideoTouchEnd : undefined}
        >
          {mediaError ? (
            <div className="flex max-w-[min(92vw,420px)] flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/65 px-6 py-8 text-center text-white/80 backdrop-blur-xl">
              <AlertTriangle className="size-8 text-amber-300" />
              <div>
                <p className="text-sm font-medium text-white">Preview could not be loaded</p>
                <p className="mt-1 text-xs text-white/55">The file may be temporarily unavailable. Try opening it in a new tab.</p>
              </div>
              <Button asChild size="sm" variant="secondary">
                <a href={file.publicUrl} target="_blank" rel="noreferrer">Open file</a>
              </Button>
            </div>
          ) : isVideo ? (
            <video
              key={file.id}
              src={file.publicUrl}
              poster={file.thumbnailUrl ?? undefined}
              controls
              preload="metadata"
              playsInline
              onLoadedData={() => setMediaError(false)}
              onError={() => setMediaError(true)}
              className="max-h-[min(82dvh,900px)] max-w-[min(92vw,1200px)] rounded-xl border border-white/10 bg-black object-contain shadow-2xl"
            />
          ) : (
            <img
              key={file.id}
              src={file.publicUrl}
              alt={file.originalName}
              draggable={false}
              onLoad={() => setMediaError(false)}
              onError={() => setMediaError(true)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onDoubleClick={handleImageDoubleClick}
              onWheel={handleImageWheel}
              className={cn(
                mediaFitClass,
                "block rounded-xl border border-white/10 bg-black object-contain shadow-2xl select-none touch-none",
                zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
              )}
              style={{
                transform: \`translate3d(\${pan.x}px, \${pan.y}px, 0) rotate(\${rotation}deg) scale(\${zoom})\`,
                transformOrigin: "center",
                transition: pointers.current.size ? "none" : "transform 140ms ease-out",
              }}
            />
          )}
        </div>

        </div>

        {!isVideo && (
          <Button
            variant="ghost"
            className="absolute bottom-4 right-3 z-30 h-10 rounded-xl border border-white/10 bg-black/55 px-3 text-white/85 shadow-lg backdrop-blur-xl hover:bg-white/10 hover:text-white sm:right-5"
            onClick={(event) => {
              event.stopPropagation();
              rotate();
            }}
            aria-label="Rotate image 90 degrees"
            title="Rotate image 90° (R)"
          >
            <RotateCw className="mr-2 size-4" />
            Rotate
          </Button>
        )}

        {siblings.length > 1 && (
          <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] text-white/75 shadow-lg backdrop-blur-xl">
            {currentIndex >= 0 ? currentIndex + 1 : "—"} / {siblings.length}
            <span className="hidden sm:inline"> · Swipe or use ← →</span>
          </div>
        )}
      </div>
      </div>
    ),
    document.body
  );
}
