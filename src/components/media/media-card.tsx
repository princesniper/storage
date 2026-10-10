"use client";
import { useState } from "react";
import { Film, Copy, Check, Eye, Trash2, Play, Music, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, isVideoMime, isAudioMime, isRawMime } from "@/lib/format";
import { VideoThumbnail } from "./video-thumbnail";
import { RawPreview } from "./raw-preview";

export interface MediaFile {
  id: number;
  publicId: string;
  sequenceNumber: number | null;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  publicUrl: string;
  width: number | null;
  height: number | null;
  previewStatus?: string;
  previewUrl?: string | null;
  previewError?: string | null;
  createdAt: string;
  storageChannel: { id: number; name: string };
}

interface MediaCardProps {
  file: MediaFile;
  index?: number;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
}

function formatSeq(n: number | null): string {
  if (n === null) return "——";
  return String(n).padStart(6, "0");
}

export function MediaCard({ file, index = 0, selected, onSelect, onOpen, onDelete }: MediaCardProps) {
  const [copied, setCopied] = useState(false);
  const isVideo = isVideoMime(file.mimeType);
  const isAudio = isAudioMime(file.mimeType);
  const isRaw = isRawMime(file.mimeType);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(file.publicUrl); } catch { /* fallback omitted */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  const handleOpen = () => onOpen?.();

  return (
    <div
      className={cn(
        "clay-media-card group relative rounded-xl border overflow-hidden cursor-pointer card-interactive animate-page-enter bg-card",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        selected ? "ring-2 ring-primary border-primary/40" : "border-border hover:border-primary/30"
      )}
      style={{ "--enter-delay": `${Math.min(index, 15) * 20}ms` } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${file.originalName} — open preview`}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); }
      }}
    >
      {/* ─── Media canvas (no zoom-on-hover: ops grid stays calm) ─── */}
      <div className="media-card__canvas aspect-square bg-muted relative overflow-hidden">
        {/* Thumbnail / image */}
        <span className="block size-full">
          {isVideo ? (
            <VideoThumbnail
              src={file.publicUrl}
              alt={file.originalName}
              className="size-full object-cover"
              previewUrl={file.previewUrl}
              previewStatus={file.previewStatus}
              fallback={<div className="flex size-full items-center justify-center bg-muted/20"><Film className="size-12 text-muted-foreground/50" /></div>}
            />
          ) : isAudio ? (
            <div className="flex size-full items-center justify-center bg-muted/20"><Music className="size-12 text-muted-foreground/50" /></div>
          ) : isRaw ? (
            <RawPreview src={file.previewUrl || file.publicUrl} alt={file.originalName} status={file.previewStatus} error={file.previewError} />
          ) : (
            <img src={file.publicUrl} alt="" loading="lazy" className="size-full object-cover" />
          )}
        </span>

        {/* Sequence pill — top right */}
        <span className="absolute top-2 right-2 z-10 font-mono tabular-nums text-[10px] font-semibold px-1.5 py-0.5 rounded-lg bg-black/60 backdrop-blur text-white/80 border border-white/[0.08]">
          {formatSeq(file.sequenceNumber)}
        </span>

        {/* Video indicator — bottom left */}
        {isRaw ? (
          <span className="absolute bottom-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-black/60 backdrop-blur border border-white/[0.08]">
            <Camera className="size-2.5 text-white/70" aria-hidden />
            <span className="text-[10px] font-semibold text-white/80">RAW</span>
          </span>
        ) : isVideo && (
          <span className="absolute bottom-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-black/60 backdrop-blur border border-white/[0.08]">
            <Play className="size-2.5 text-white/70 fill-white/70" aria-hidden />
            <span className="text-[10px] font-semibold text-white/80">VIDEO</span>
          </span>
        )}

        {/* Deleted/inactive overlay */}
        {file.status !== "active" && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-[11px] font-medium text-white/70 uppercase tracking-wider">
              {file.status}
            </span>
          </div>
        )}

        {/* Selection checkbox */}
        {onSelect && (
          <span
            className={cn(
              "absolute top-2 left-2 z-10 duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-opacity",
              selected ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
              file.status !== "active" && "cursor-not-allowed opacity-40"
            )}
            onClick={(e) => { e.stopPropagation(); if (file.status === "active") onSelect(); }}
          >
            <span
              className={cn(
                "size-5 rounded-lg border flex items-center justify-center duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,border-color]",
                selected ? "bg-primary border-primary" : "bg-black/50 border-white/30 backdrop-blur"
              )}
              aria-label={`${selected ? "Deselect" : "Select"} ${file.originalName}`}
              role="checkbox"
              tabIndex={file.status === "active" ? 0 : -1}
              aria-disabled={file.status !== "active"}
              aria-checked={selected}
              onKeyDown={(e) => { e.stopPropagation(); if (file.status === "active" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(); } }}
            >
              {selected && <Check className="size-3 text-primary-foreground" aria-hidden />}
            </span>
          </span>
        )}

        {/* Hover/focus quick-action overlay (focus-within keeps it keyboard-reachable) */}
        <span
          className="absolute inset-x-2 bottom-2 z-10 hidden md:flex items-center gap-1 rounded-lg bg-black/70 backdrop-blur-sm px-1.5 py-1.5 shadow-lg opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[opacity,transform]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopy}
            aria-label={`Copy public URL for ${file.originalName}`}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 h-7 rounded-lg text-[11px] font-medium duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,color]",
              copied ? "text-emerald-400 bg-emerald-500/10" : "text-white/80 hover:text-white hover:bg-white/10"
            )}
            title="Copy URL"
          >
            {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
            aria-label={`Preview ${file.originalName}`}
            className="size-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,color]"
            title="Preview"
          >
            <Eye className="size-3.5" aria-hidden />
          </button>
          {onDelete && (
            <button
              onClick={handleDelete}
              aria-label={`Delete ${file.originalName}`}
              className="size-7 flex items-center justify-center rounded-lg text-red-400/80 hover:text-red-400 hover:bg-red-500/10 duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,color]"
              title="Delete"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      </div>

      {/* ─── Metadata footer ─── */}
      <div className="media-card__metadata px-3 py-2.5 space-y-1">
        <div className="text-[11px] font-medium truncate text-foreground/90" title={file.originalName}>
          {file.originalName}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{formatBytes(Number(file.size))}</span>
          <span className="truncate ml-2 max-w-[50%] text-right">{file.storageChannel?.name}</span>
        </div>
      </div>
    </div>
  );
}
