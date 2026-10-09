"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Folder, FolderOpen, Loader2, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type FolderRow = { id: number; name: string; parentId: number | null };

export function BulkFileActions({ selectedIds, onSelectionChange }: { selectedIds: number[]; onSelectionChange: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState("root");
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set([0]));
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const openPicker = async () => {
    setOpen(true); setError(""); setFolderId("root"); setExpandedFolders(new Set([0])); setLoadingFolders(true);
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

  const childrenByParent = useMemo(() => {
    const tree = new Map<number | null, FolderRow[]>();
    for (const folder of folders) {
      const children = tree.get(folder.parentId) ?? [];
      children.push(folder);
      tree.set(folder.parentId, children);
    }
    for (const children of tree.values()) children.sort((a, b) => a.name.localeCompare(b.name));
    return tree;
  }, [folders]);

  const toggleExpanded = (id: number) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, id: number | null) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFolderId(id === null ? "root" : String(id));
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const tree = event.currentTarget.closest('[role="tree"]');
      const items = tree ? Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) : [];
      const currentIndex = items.indexOf(event.currentTarget);
      const targetIndex = event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
      if (items[targetIndex]) {
        event.preventDefault();
        items[targetIndex].focus();
      }
    } else if (event.key === "ArrowRight") {
      const key = id ?? 0;
      const hasChildren = (childrenByParent.get(id) ?? []).length > 0;
      if (hasChildren && !expandedFolders.has(key)) {
        event.preventDefault();
        setExpandedFolders((previous) => new Set(previous).add(key));
      }
    } else if (event.key === "ArrowLeft") {
      const key = id ?? 0;
      if (expandedFolders.has(key)) {
        event.preventDefault();
        setExpandedFolders((previous) => { const next = new Set(previous); next.delete(key); return next; });
      }
    }
  };

  const renderChildren = (parentId: number | null, depth: number): React.ReactNode =>
    (childrenByParent.get(parentId) ?? []).map((folder) => {
      const children = childrenByParent.get(folder.id) ?? [];
      const hasChildren = children.length > 0;
      const expanded = expandedFolders.has(folder.id);
      const selected = folderId === String(folder.id);
      return (
        <div key={folder.id}>
          <div
            role="treeitem"
            tabIndex={0}
            aria-selected={selected}
            aria-expanded={hasChildren ? expanded : undefined}
            onClick={() => setFolderId(String(folder.id))}
            onKeyDown={(event) => handleTreeKeyDown(event, folder.id)}
            className={`flex min-h-9 items-center gap-2 rounded-md pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-accent text-accent-foreground ring-1 ring-primary/30" : "hover:bg-accent/60"}`}
            style={{ paddingLeft: 8 + Math.min(depth, 12) * 16 }}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
              aria-hidden={!hasChildren}
              disabled={!hasChildren}
              onClick={(event) => { event.stopPropagation(); if (hasChildren) toggleExpanded(folder.id); }}
              className="flex size-5 shrink-0 items-center justify-center disabled:opacity-0"
            >
              {hasChildren ? expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : null}
            </button>
            {hasChildren && expanded ? <FolderOpen className="size-4 shrink-0 text-amber-500" aria-hidden /> : <Folder className="size-4 shrink-0 text-amber-500" aria-hidden />}
            <span className="min-w-0 truncate" title={folder.name}>{folder.name}</span>
          </div>
          {hasChildren && expanded && <div role="group">{renderChildren(folder.id, depth + 1)}</div>}
        </div>
      );
    });

  const selectedFolder = folders.find((folder) => String(folder.id) === folderId);
  const selectedDestination = folderId === "root" ? "/ (Root)" : selectedFolder ? pathFor(selectedFolder) : "Destination unavailable";

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
      await qc.invalidateQueries({ queryKey: ["folder-browser"] });
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
        {loadingFolders ? (
          <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />Loading folders…</div>
        ) : !error ? (
          <div className="space-y-2">
            <span className="text-sm font-medium">Destination folder</span>
            <div role="tree" aria-label="Destination folders" className="max-h-64 space-y-0.5 overflow-auto rounded-md border p-2">
              <div
                role="treeitem"
                tabIndex={0}
                aria-selected={folderId === "root"}
                aria-expanded={expandedFolders.has(0)}
                onClick={() => setFolderId("root")}
                onKeyDown={(event) => handleTreeKeyDown(event, null)}
                className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${folderId === "root" ? "bg-accent text-accent-foreground ring-1 ring-primary/30" : "hover:bg-accent/60"}`}
              >
                <button type="button" tabIndex={-1} aria-label={`${expandedFolders.has(0) ? "Collapse" : "Expand"} root folders`} onClick={(event) => { event.stopPropagation(); toggleExpanded(0); }} className="flex size-5 shrink-0 items-center justify-center">
                  {expandedFolders.has(0) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <FolderOpen className="size-4 shrink-0 text-amber-500" aria-hidden />
                <span>/ (Root)</span>
              </div>
              {expandedFolders.has(0) && <div role="group">{renderChildren(null, 0)}</div>}
              {folders.length === 0 && <p className="px-9 py-2 text-xs text-muted-foreground">No child folders. Root is still a valid destination.</p>}
            </div>
            <p className="text-xs text-muted-foreground">Selected destination: <span className="font-medium text-foreground break-all">{selectedDestination}</span></p>
          </div>
        ) : null}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || loadingFolders || !!error || (folderId !== "root" && !selectedFolder)} onClick={move}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}{busy ? "Moving…" : "Move files"}</Button></DialogFooter>
        <p className="text-xs text-muted-foreground">Bulk operations support up to 100 files per request. Downloads support up to 25 files and 512 MiB total.</p>
      </DialogContent>
    </Dialog>
  </>;
}
