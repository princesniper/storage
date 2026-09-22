"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExternalLink, Trash2, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyButton } from "@/components/ui/copy-button";
import { AuditStatusBadge, FileStatusBadge } from "@/components/ui/status-badge";
import { DetailsSkeleton } from "@/components/ui/skeletons";
import { formatBytes, formatDateTime, isVideoMime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface HistoryEntry {
  id: number;
  operation: string;
  status: string;
  errorMessage: string | null;
  ip: string | null;
  adminEmail: string | null;
  createdAt: string;
}

interface DetailFile {
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
  thumbnailPublicId: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  telegramMessageId: number;
  channel: { id: number; name: string };
  history: HistoryEntry[];
}

export default function FileDetailModal({
  fileId,
  open,
  onClose,
  onDeleted,
  siblings,
  onNavigate,
}: {
  fileId: number | null;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
  /** Ordered ids of surrounding files for prev/next lightbox navigation. */
  siblings?: number[];
  onNavigate?: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const { data: detail, isLoading: loading } = useQuery<DetailFile>({
    queryKey: ["file-detail", fileId],
    queryFn: async () => {
      const r = await fetch(`/api/files/${fileId}`);
      if (!r.ok) throw new Error("Failed to load file details");
      const json = await r.json();
      return json.file as DetailFile;
    },
    enabled: open && fileId !== null,
    staleTime: 30_000,
  });

  const closeHandler = () => {
    setConfirmDelete(false);
    setZoomed(false);
    onClose();
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  const sibIndex = siblings && fileId !== null ? siblings.indexOf(fileId) : -1;
  const hasNav = siblings && siblings.length > 1 && sibIndex >= 0 && onNavigate;
  const navigateTo = useCallback((id: number) => {
    setConfirmDelete(false);
    setZoomed(false);
    onNavigate?.(id);
  }, [onNavigate]);
  const goPrev = useCallback(() => {
    if (!hasNav || !siblings) return;
    navigateTo(siblings[(sibIndex - 1 + siblings.length) % siblings.length]);
  }, [hasNav, siblings, sibIndex, navigateTo]);
  const goNext = useCallback(() => {
    if (!hasNav || !siblings) return;
    navigateTo(siblings[(sibIndex + 1) % siblings.length]);
  }, [hasNav, siblings, sibIndex, navigateTo]);

  // Keyboard: arrows navigate, +/- zoom images
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  const handleDelete = async () => {
    if (!detail) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const r = await fetch(`/api/files/${detail.id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Delete failed");
      }
      toast({ title: "Media deleted", description: "Public URL stopped working." });
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["file-detail"] });
      closeHandler();
      onDeleted?.();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const video = detail ? isVideoMime(detail.mimeType) : false;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeHandler()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-full sm:mx-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{detail?.originalName ?? "File details"}</DialogTitle>
          <DialogDescription>
            Full metadata and audit history.
            {hasNav && (
              <span className="text-muted-foreground"> · {sibIndex + 1} of {siblings!.length}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <DetailsSkeleton />
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-muted/30 border border-border/50">
              <div
                className={cn(
                  "flex items-center justify-center max-h-[420px] overflow-auto",
                  !video && zoomed ? "cursor-zoom-out" : !video ? "cursor-zoom-in" : ""
                )}
                onClick={() => {
                  if (!video) setZoomed((z) => !z);
                }}
              >
                {video ? (
                  <video
                    key={detail.publicId}
                    src={detail.publicUrl}
                    poster={detail.thumbnailUrl ?? undefined}
                    controls
                    preload="metadata"
                    playsInline
                    className="max-h-[420px] max-w-full animate-page-enter"
                  />
                ) : (
                  <img
                    key={detail.publicId}
                    src={detail.publicUrl}
                    alt={detail.originalName}
                    className={cn(
                      "max-w-full duration-[var(--duration-standard)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-transform animate-page-enter",
                      zoomed ? "max-h-none w-[160%] scale-100" : "max-h-[420px] object-contain"
                    )}
                    draggable={false}
                  />
                )}
              </div>
              {/* Lightbox controls */}
              <div className="absolute top-2 right-2 flex gap-1">
                {!video && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="size-8 shadow-md"
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomed((z) => !z);
                    }}
                    aria-label={zoomed ? "Zoom out" : "Zoom in"}
                    title={zoomed ? "Zoom out" : "Zoom in (click image)"}
                  >
                    {zoomed ? <ZoomOut className="size-4" aria-hidden /> : <ZoomIn className="size-4" aria-hidden />}
                  </Button>
                )}
              </div>
              {hasNav && (
                <>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute left-2 top-1/2 -translate-y-1/2 size-9 rounded-full shadow-md opacity-90 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      goPrev();
                    }}
                    aria-label="Previous file"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-9 rounded-full shadow-md opacity-90 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      goNext();
                    }}
                    aria-label="Next file"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </>
              )}
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Original filename" mono copyable onCopy={() => copy(detail.originalName, "Filename")}>
                {detail.originalName}
              </Field>
              <Field label="Public ID" mono copyable onCopy={() => copy(detail.publicId, "Public ID")}>
                {detail.publicId}
              </Field>
              <Field label="Sequence number" mono>
                {detail.sequenceNumber != null ? `#${String(detail.sequenceNumber).padStart(6, "0")}` : "— (legacy, run backfill)"}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Public URL" mono copyable onCopy={() => copy(detail.publicUrl, "URL")}>
                  <span className="break-all">{detail.publicUrl}</span>
                </Field>
              </div>
              <Field label="MIME type">{detail.mimeType}</Field>
              <Field label="File size">{formatBytes(detail.size)}</Field>
              <Field label="Dimensions">
                {detail.width && detail.height ? `${detail.width} × ${detail.height}` : "—"}
              </Field>
              <Field label="Storage channel">{detail.channel?.name}</Field>
              <Field label="Status">
                <FileStatusBadge status={detail.status} />
              </Field>
              <Field label="Created at">{formatDateTime(detail.createdAt)}</Field>
              <Field label="Updated at">{formatDateTime(detail.updatedAt)}</Field>
            </dl>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1">
                  Debug info <ChevronDown className="size-3.5" aria-hidden />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="text-xs font-mono bg-muted rounded-lg p-3 mt-1 space-y-1">
                  <div>telegramMessageId: {detail.telegramMessageId}</div>
                  <div>dbId: {detail.id}</div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div>
              <h4 className="text-sm font-medium mb-2">Audit history</h4>
              {detail.history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No audit entries for this file.</p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {detail.history.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-xs border border-border rounded-lg px-2 py-1.5">
                      <Badge variant="outline" className="font-mono shrink-0">{h.operation}</Badge>
                      <AuditStatusBadge status={h.status} />
                      <span className="text-muted-foreground truncate flex-1">
                        {h.errorMessage ?? h.adminEmail ?? ""}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">{formatDateTime(h.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {detail && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={detail.publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5 mr-1" aria-hidden /> Open in new tab
                </a>
              </Button>
              <CopyButton text={detail.publicUrl} label="Copy URL" size="sm" variant="outline" onCopy={() => toast({ title: "Copied", description: "Public URL copied to clipboard." })} />
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                <Trash2 className="size-3.5 mr-1" aria-hidden />
                {confirmDelete ? (deleting ? "Deleting…" : "Delete media") : "Delete media"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  mono,
  copyable,
  onCopy,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  copyable?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
        {label}
        {copyable && (
          <button onClick={onCopy} className="hover:text-foreground transition-colors rounded" aria-label={`Copy ${label}`}>
            <Copy className="size-3" aria-hidden />
          </button>
        )}
      </dt>
      <dd className={`text-sm break-words ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  );
}
