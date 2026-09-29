"use client";
import { useState } from "react";
import { X, ExternalLink, Trash2, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatBytes, formatDateTime } from "@/lib/format";
import { FileStatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import type { MediaFile } from "./media-card";
import { canonicalUrl as buildCanonicalUrl } from "@/lib/media-url";

interface MediaInspectorProps {
  file: MediaFile;
  onClose?: () => void;
  onDeleted?: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 border-b border-white/[0.05]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">
        {label}
      </span>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  );
}

export function MediaInspector({ file, onClose, onDeleted }: MediaInspectorProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const seq = file.sequenceNumber !== null ? String(file.sequenceNumber).padStart(6, "0") : "——";
  // Reconstruct canonical URL if publicUrl doesn't already use the media origin
  const canonicalUrl = file.sequenceNumber !== null
    ? buildCanonicalUrl(file.sequenceNumber, file.mimeType)
    : file.publicUrl;

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(canonicalUrl); } catch { /* noop */ }
    setCopied(true);
    toast({ title: "Copied", description: "Public URL copied to clipboard." });
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDelete = async () => {
    try {
      const r = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast({ title: "Delete failed", description: j.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: "Media deleted", description: "Public URL stopped working." });
      onDeleted?.();
    } catch (err) {
      toast({ title: "Delete failed", description: "Network error", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
        <h2 className="text-sm font-semibold text-foreground">File Inspector</h2>
        {onClose && (
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close inspector">
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-4">
        <Row label="Sequence">
          <span className="font-mono text-lg font-semibold text-emerald-400">{seq}</span>
        </Row>

        <Row label="Canonical URL">
          <div className="flex flex-col gap-2">
            <code className="text-[11px] font-mono text-muted-foreground break-all leading-relaxed bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2">
              {canonicalUrl}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCopy}
            >
              {copied
                ? <><Check className="size-3.5 mr-1.5" aria-hidden />Copied</>
                : <><Copy className="size-3.5 mr-1.5" aria-hidden />Copy URL</>
              }
            </Button>
          </div>
        </Row>

        <Row label="Channel">
          <span className="text-muted-foreground">{file.storageChannel?.name ?? "—"}</span>
        </Row>

        {file.width && file.height && (
          <Row label="Dimensions">
            <span className="font-mono text-sm">{file.width} × {file.height}</span>
          </Row>
        )}

        <Row label="File Size">
          <span>{formatBytes(Number(file.size))}</span>
        </Row>

        <Row label="MIME Type">
          <span className="font-mono text-xs text-muted-foreground">{file.mimeType}</span>
        </Row>

        <Row label="Uploaded">
          <span className="text-muted-foreground text-xs">{formatDateTime(file.createdAt)}</span>
        </Row>

        <Row label="Status">
          <FileStatusBadge status={file.status} />
        </Row>

        <Row label="Public ID">
          <span className="font-mono text-xs text-muted-foreground break-all">{file.publicId}</span>
        </Row>
      </div>

      {/* Actions */}
      <div className="shrink-0 p-4 border-t border-white/[0.06] space-y-2">
        <Button variant="outline" size="sm" className="w-full" asChild>
          <a href={canonicalUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5 mr-1.5" aria-hidden />
            Open in New Tab
          </a>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="size-3.5 mr-1.5" aria-hidden />
              Delete File
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete media?</AlertDialogTitle>
              <AlertDialogDescription>
                The public URL will become unavailable. This is a soft-delete and can be recovered from the database;
                its sequence number stays consumed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDelete}
              >
                Delete media
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
