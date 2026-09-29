"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, MoreVertical, RotateCw } from "lucide-react";
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

export function MediaLightbox({ file, siblings = [], open, onClose, onNavigate, onDeleted }: MediaLightboxProps) {
  const currentIndex = file ? siblings.indexOf(file.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < siblings.length - 1;
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const dragStart = useRef<{ point: Point; pan: Point } | null>(null);
  const swipeStart = useRef<Point | null>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    pinchStart.current = null;
    dragStart.current = null;
  }, []);

  const goPrev = useCallback(() => {
    if (hasPrev && onNavigate) onNavigate(siblings[currentIndex - 1]);
  }, [hasPrev, onNavigate, siblings, currentIndex]);

  const goNext = useCallback(() => {
    if (hasNext && onNavigate) onNavigate(siblings[currentIndex + 1]);
  }, [hasNext, onNavigate, siblings, currentIndex]);

  useEffect(() => {
    if (!open) return;
    resetView();
    setIsInspectorOpen(false);
  }, [file?.id, open, resetView]);

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
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
      else if (event.key === "0") resetView();
      else if (event.key === "r" || event.key === "R") setRotation((value) => (value + 90) % 360);
      else if (event.key === "r" || event.key === "R") setRotation((value) => (value + 90) % 360);
      else if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(MAX_ZOOM, value + 0.25));
      else if (event.key === "-") setZoom((value) => Math.max(MIN_ZOOM, value - 0.25));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, goPrev, goNext, resetView]);

  useEffect(() => {
    if (!open) {
      pointers.current.clear();
      pinchStart.current = null;
      dragStart.current = null;
      swipeStart.current = null;
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
    pinchStart.current = pointers.current.size === 2 ? pinchStart.current : null;
    if (pointers.current.size === 0) {
      dragStart.current = null;
      swipeStart.current = null;
      if (zoom === 1 && start && Math.abs(end.x - start.x) > 70 && Math.abs(end.y - start.y) < 80) {
        if (end.x > start.x) goPrev();
        else goNext();
      }
    }
  };

  if (!open || !file) return null;

  const isVideo = isVideoMime(file.mimeType);

  return (
    <div
      className={cn("fixed inset-0 z-50 flex flex-col md:flex-row", "bg-black/85 backdrop-blur-sm", "animate-in fade-in duration-[var(--duration-modal)]")}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${file.originalName}`}
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div ref={viewportRef} className="relative flex-1 min-h-0 flex items-center justify-center p-4 md:p-8 min-w-0 bg-black/10">
        <Button variant="ghost" size="icon" className="absolute top-4 right-4 z-20 size-9 text-white/70 hover:text-white hover:bg-white/10" onClick={onClose} aria-label="Close preview">
          <X className="size-5" />
        </Button>

        {hasPrev && <Button variant="ghost" size="icon" className="absolute left-4 z-20 size-10 text-white/70 hover:text-white hover:bg-white/10 rounded-full" onClick={goPrev} aria-label="Previous file"><ChevronLeft className="size-6" /></Button>}
        {hasNext && <Button variant="ghost" size="icon" className="absolute right-4 z-20 size-10 text-white/70 hover:text-white hover:bg-white/10 rounded-full" onClick={goNext} aria-label="Next file"><ChevronRight className="size-6" /></Button>}

        <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 max-w-[60vw] rounded-xl bg-black/55 px-3 py-2 text-center backdrop-blur border border-white/[0.08]">
          <div className="truncate text-xs font-medium text-white/95">{file.originalName}</div>
          <div className="mt-0.5 text-[10px] text-white/50">
            {file.sequenceNumber !== null ? `#${String(file.sequenceNumber).padStart(6, "0")} · ` : ""}{file.mimeType} · {Math.round(file.size / 1024 / 1024 * 10) / 10} MB
          </div>
        </div>

        <div className="absolute right-4 top-4 z-40 flex items-center gap-1">
          <div className="relative">
            <Button variant="ghost" size="icon" className={cn("size-10 rounded-xl border border-white/[0.08] bg-black/45 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-white", isInspectorOpen && "bg-white/15 text-white")} onClick={() => setIsInspectorOpen((value) => !value)} aria-label="Open file inspector and actions" aria-expanded={isInspectorOpen}>
              <MoreVertical className="size-5" />
            </Button>
            {isInspectorOpen && (
              <div className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#111113]/[98%] shadow-2xl shadow-black/50 backdrop-blur-xl" onClick={(event) => event.stopPropagation()}>
                <MediaInspector file={file} onClose={() => setIsInspectorOpen(false)} onDeleted={() => { onDeleted?.(); onClose(); }} />
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" className="size-10 rounded-xl border border-white/[0.08] bg-black/45 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close preview">
            <X className="size-5" />
          </Button>
        </div>
        {!isVideo && (
          <Button variant="ghost" className="absolute bottom-4 right-4 z-30 h-9 rounded-xl border border-white/[0.08] bg-black/45 px-3 text-white/85 backdrop-blur-md hover:bg-white/10 hover:text-white" onClick={() => setRotation((value) => (value + 90) % 360)} aria-label="Rotate image 90 degrees" title="Rotate image 90° (R)">
            <RotateCw className="mr-2 size-4" />Rotate
          </Button>
        )}

        <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
          {isVideo ? (
            <video ref={videoRef} key={file.id} src={file.publicUrl} controls playsInline className="max-w-full max-h-[82vh] rounded-xl shadow-2xl border border-white/[0.06] bg-black" />
          ) : (
            <img
              ref={imageRef}
              key={file.id}
              src={file.publicUrl}
              alt={file.originalName}
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onDoubleClick={() => { if (zoom > 1) resetView(); else setZoom(2); }}
              onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + (event.deltaY < 0 ? 0.2 : -0.2)))); }}
              className="max-w-full max-h-[82vh] rounded-xl shadow-2xl border border-white/[0.06] object-contain select-none touch-none"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`, transformOrigin: "center", cursor: zoom > 1 ? "grab" : "zoom-in", transition: pointers.current.size ? "none" : "transform 120ms ease-out" }}
            />
          )}
        </div>

        {siblings.length > 1 && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur border border-white/[0.08]">{currentIndex + 1} / {siblings.length} · Swipe or use ← →</div>}
      </div>

    </div>
  );
}
