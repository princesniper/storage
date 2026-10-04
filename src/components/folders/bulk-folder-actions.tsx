"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Move, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type FolderRow = { id: number; name: string; parentId: number | null; };
type Failure = { id: number; error: string };

export function BulkFolderActions({ selectedIds, folders, onSelectionChange }: { selectedIds: number[]; folders: FolderRow[]; onSelectionChange: (ids: number[]) => void }) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [destination, setDestination] = useState("root");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const byId = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);

  const roots = useMemo(() => selectedIds.filter(id => {
    let parent = byId.get(id)?.parentId ?? null; const seen = new Set<number>();
    while (parent !== null && !seen.has(parent)) {
      if (selectedIds.includes(parent)) return false;
      seen.add(parent); parent = byId.get(parent)?.parentId ?? null;
    }
    return true;
  }), [selectedIds, byId]);

  const pathFor = (folder: FolderRow) => {
    const parts = [folder.name]; let parent = folder.parentId; const seen = new Set([folder.id]);
    while (parent !== null && !seen.has(parent)) { seen.add(parent); const item = byId.get(parent); if (!item) break; parts.unshift(item.name); parent = item.parentId; }
    return "/" + parts.join("/");
  };
  const invalidDestination = (id: number) => roots.some(root => {
    let current: number | null = id; const seen = new Set<number>();
    while (current !== null && !seen.has(current)) { if (current === root) return true; seen.add(current); current = byId.get(current)?.parentId ?? null; }
    return false;
  });

  const move = async () => {
    setBusy(true); setError("");
    const moved: number[] = []; const failed: Failure[] = [];
    try {
      for (let i = 0; i < roots.length; i += 100) {
        const response = await fetch("/api/folders/bulk-move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: roots.slice(i, i + 100), parentId: destination === "root" ? null : Number(destination) }) });
        const json = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 207) throw new Error(json.detail || json.error || "Folder move failed.");
        moved.push(...(json.moved ?? [])); failed.push(...(json.failed ?? []));
      }
      onSelectionChange(failed.map(f => f.id));
      await queryClient.invalidateQueries({ queryKey: ["folder-browser"] });
      setMoveOpen(false);
      toast({ title: failed.length ? `${moved.length} moved, ${failed.length} failed` : `${moved.length} folders moved`, description: failed.length ? "Name conflicts or invalid operations were left unchanged." : "Nested contents stay in their folders.", variant: failed.length ? "destructive" : "default" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Folder move failed."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError("");
    const deleted: number[] = []; const failed: Failure[] = [];
    try {
      for (let i = 0; i < roots.length; i += 100) {
        const response = await fetch("/api/folders/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: roots.slice(i, i + 100) }) });
        const json = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 207) throw new Error(json.detail || json.error || "Folder deletion failed.");
        deleted.push(...(json.deleted ?? [])); failed.push(...(json.failed ?? []));
      }
      onSelectionChange(failed.map(f => f.id));
      await queryClient.invalidateQueries({ queryKey: ["folder-browser"] });
      setDeleteOpen(false);
      toast({ title: failed.length ? "Some folders could not be deleted" : "Folders deleted", description: failed.length ? `${deleted.length} folder records processed; ${failed.length} failed. Existing delete behavior is permanent for folder structure.` : `${deleted.length} folders removed. Files were marked deleted; folder structure is not recoverable.`, variant: failed.length ? "destructive" : "default" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Folder deletion failed."); }
    finally { setBusy(false); }
  };

  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/folders/bulk-download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: roots }) });
      if (!response.ok) { const json = await response.json().catch(() => ({})); throw new Error(json.detail || json.error || "Folder download failed."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `growplants-folders-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast({ title: "Folder archive download started", description: "Nested folders and active files are included within the configured limits." });
    } catch (cause) { toast({ title: "Folder download failed", description: cause instanceof Error ? cause.message : "Folder download failed.", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return <>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDestination("root"); setError(""); setMoveOpen(true); }}><Move className="mr-1 size-3" />Move</Button>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()}><Download className="mr-1 size-3" />Download ZIP</Button>
    <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setError(""); setDeleteOpen(true); }}><Trash2 className="mr-1 size-3" />Delete</Button>
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSelectionChange([])}><X className="mr-1 size-3" />Clear</Button>

    <Dialog open={moveOpen} onOpenChange={v => !busy && setMoveOpen(v)}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg">
        <DialogHeader><DialogTitle>Move {selectedIds.length} folders</DialogTitle><DialogDescription>Moving a selected parent also moves its nested folders and files. If both a parent and descendant are selected, the parent is moved only once.</DialogDescription></DialogHeader>
        <label className="grid gap-2 text-sm"><span>Destination parent folder</span><select value={destination} onChange={e => setDestination(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2"><option value="root">/ (Root)</option>{folders.filter(f => !invalidDestination(f.id)).map(f => <option key={f.id} value={String(f.id)}>{pathFor(f)}</option>)}</select></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">Duplicate folder names are rejected; folders are not overwritten or merged.</p>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMoveOpen(false)}>Cancel</Button><Button disabled={busy || (destination !== "root" && invalidDestination(Number(destination)))} onClick={() => void move()}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}{busy ? "Moving…" : "Move folders"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={deleteOpen} onOpenChange={v => !busy && setDeleteOpen(v)}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg">
        <DialogHeader><DialogTitle>Delete {selectedIds.length} selected folders?</DialogTitle><DialogDescription>This follows the existing folder-delete behavior. Folder records and nested folder structure are permanently removed; active files in those folders are marked deleted, and storage-provider cleanup is not run by this bulk operation. This is not a recoverable folder Trash.</DialogDescription></DialogHeader>
        <div className="max-h-40 overflow-y-auto rounded-lg border p-3 text-sm">{roots.map(id => <div key={id} className="truncate py-1">{byId.get(id)?.name ?? `Folder #${id}`}</div>)}{roots.length < selectedIds.length && <p className="mt-2 text-xs text-muted-foreground">Selected descendants are covered by their selected parent folders.</p>}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}{busy ? "Deleting…" : "Confirm delete"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
