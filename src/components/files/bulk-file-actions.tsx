"use client";

import { useState } from "react";
import { Download, Loader2, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type FolderRow = { id: number; name: string; parentId: number | null };

export function BulkFileActions({ selectedIds, onSelectionChange }: { selectedIds: number[]; onSelectionChange: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState("root");
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const openPicker = async () => {
    setOpen(true); setError(""); setFolderId("root"); setLoadingFolders(true);
    try {
      const response = await fetch("/api/folders?all=true", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.detail || json.error || "Unable to load folders.");
      setFolders(json.folders ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load folders."); }
    finally { setLoadingFolders(false); }
  };

  const pathFor = (folder: FolderRow) => {
    const parts = [folder.name]; let parent = folder.parentId; const seen = new Set([folder.id]);
    while (parent !== null && !seen.has(parent)) { seen.add(parent); const item = folders.find((f) => f.id === parent); if (!item) break; parts.unshift(item.name); parent = item.parentId; }
    return "/" + parts.join("/");
  };

  const move = async () => {
    setBusy(true); setError("");
    try {
      const aggregate: { moved: number[]; failed: { id: number; error: string }[] } = { moved: [], failed: [] };
      for (let i = 0; i < selectedIds.length; i += 100) {
        const response = await fetch("/api/files/bulk-move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selectedIds.slice(i, i + 100), folderId: folderId === "root" ? null : Number(folderId) }) });
        const json = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 207) throw new Error(json.detail || json.error || "Move failed.");
        aggregate.moved.push(...(json.moved ?? [])); aggregate.failed.push(...(json.failed ?? []));
      }
      onSelectionChange(aggregate.failed.map((item) => item.id));
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["files"] });
      const moved = aggregate.moved.length; const failed = aggregate.failed.length;
      toast({ title: failed ? `${moved} moved, ${failed} failed` : `${moved} files moved`, description: failed ? "Conflicts and unavailable files were left unchanged. Failed items remain selected." : "Files moved without re-uploading.", variant: failed ? "destructive" : "default" });
    } catch (e) { setError(e instanceof Error ? e.message : "Move failed."); }
    finally { setBusy(false); }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch("/api/files/bulk-download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selectedIds }) });
      if (!response.ok) { const json = await response.json().catch(() => ({})); throw new Error(json.detail || json.error || "Download failed."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; if (selectedIds.length > 1) anchor.download = `growplants-media-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast({ title: "Download started", description: selectedIds.length === 1 ? "Your file is downloading." : "Your ZIP archive is downloading." });
    } catch (e) { toast({ title: "Download failed", description: e instanceof Error ? e.message : "Download failed.", variant: "destructive" }); }
    finally { setDownloading(false); }
  };

  return <>
    <Button size="sm" variant="outline" onClick={openPicker} disabled={busy || downloading}><Move className="mr-1 size-3" />Move</Button>
    <Button size="sm" variant="outline" onClick={download} disabled={busy || downloading}><Download className="mr-1 size-3" />{downloading ? "Preparing…" : "Download"}</Button>
    <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg">
        <DialogHeader><DialogTitle>Move {selectedIds.length} files</DialogTitle><DialogDescription>Choose a destination. File content is not re-uploaded. Duplicate names are skipped and reported.</DialogDescription></DialogHeader>
        {loadingFolders ? <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />Loading folders…</div> : <label className="grid gap-2 text-sm"><span>Destination folder</span><select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2"><option value="root">/ (Root)</option>{folders.map((folder) => <option key={folder.id} value={String(folder.id)}>{pathFor(folder)}</option>)}</select></label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || loadingFolders || !!error} onClick={move}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}{busy ? "Moving…" : "Move files"}</Button></DialogFooter>
        <p className="text-xs text-muted-foreground">Bulk operations support up to 100 files per request. Downloads support up to 25 files and 512 MiB total.</p>
      </DialogContent>
    </Dialog>
  </>;
}
