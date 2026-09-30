"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Folder, Loader2, MoreVertical, Move, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type FolderRow = { id: number; name: string; parentId: number | null };
type ItemType = "file" | "folder";

function MoveDestinationPicker({
  open,
  onOpenChange,
  itemType,
  itemId,
  itemName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemType: ItemType;
  itemId: number;
  itemName: string;
}) {
  const queryClient = useQueryClient();
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const foldersQuery = useQuery<FolderRow[]>({
    queryKey: ["folder-actions", "folders"],
    enabled: open,
    queryFn: async () => {
      const response = await fetch("/api/folders?all=true", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load folders.");
      const json = await response.json();
      return json.folders ?? [];
    },
  });

  const folders = foldersQuery.data ?? [];
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const children = folders.filter((folder) => folder.parentId === currentId);

  const breadcrumbs = useMemo(() => {
    const result: FolderRow[] = [];
    let id = currentId;
    const seen = new Set<number>();
    while (id !== null && !seen.has(id)) {
      seen.add(id);
      const folder = folderMap.get(id);
      if (!folder) break;
      result.unshift(folder);
      id = folder.parentId;
    }
    return result;
  }, [currentId, folderMap]);

  const invalidDestination = (destinationId: number | null) => {
    if (itemType !== "folder" || destinationId === null) return false;
    let id: number | null = destinationId;
    const seen = new Set<number>();
    while (id !== null && !seen.has(id)) {
      if (id === itemId) return true;
      seen.add(id);
      id = folderMap.get(id)?.parentId ?? null;
    }
    return false;
  };

  const move = async () => {
    if (invalidDestination(currentId)) {
      setError("A folder cannot be moved into itself or one of its descendants.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const endpoint = itemType === "folder" ? `/api/folders/${itemId}` : `/api/files/${itemId}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: currentId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.detail || json.error || "Move failed");
      await queryClient.invalidateQueries({ queryKey: ["folder-browser"] });
      await queryClient.invalidateQueries({ queryKey: ["folder-actions"] });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Move failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move &quot;{itemName}&quot;</DialogTitle>
          <DialogDescription>Choose a destination. The item is moved without re-uploading.</DialogDescription>
        </DialogHeader>

        {foldersQuery.isLoading ? (
          <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading folders...
          </div>
        ) : foldersQuery.isError ? (
          <div className="rounded-lg border p-8 text-center text-sm text-destructive">
            Unable to load folders.
            <Button variant="outline" size="sm" className="mt-3" onClick={() => foldersQuery.refetch()}>Retry</Button>
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
                <button className="font-medium hover:underline" onClick={() => setCurrentId(null)}>Home</button>
                {breadcrumbs.map((folder) => (
                  <span key={folder.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" />
                    <button className="max-w-32 truncate hover:underline" onClick={() => setCurrentId(folder.id)}>{folder.name}</button>
                  </span>
                ))}
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {children.map((folder) => {
                  const disabled = invalidDestination(folder.id);
                  return (
                    <button
                      key={folder.id}
                      disabled={disabled}
                      onClick={() => setCurrentId(folder.id)}
                      className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Folder className="h-5 w-5 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  );
                })}
                {!children.length && <div className="py-8 text-center text-sm text-muted-foreground">No subfolders<br /><span className="text-xs">You can move the item here.</span></div>}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Destination: </span>
              <span className="font-medium">/{breadcrumbs.map((folder) => folder.name).join("/")}</span>
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || foldersQuery.isLoading || foldersQuery.isError || invalidDestination(currentId)} onClick={move}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? "Moving..." : "Move here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewFolderButton({ parentId }: { parentId: number | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    const value = name.trim();
    if (!value) { setError("Folder name is required."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value, parentId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.detail || json.error || "Failed to create folder");
      await queryClient.invalidateQueries({ queryKey: ["folder-browser"] });
      setName("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create folder");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => { setError(""); setOpen(true); }}>
        <Plus className="mr-2 h-4 w-4" />New Folder
      </Button>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>{parentId ? "Create inside the current folder." : "Create at root."}</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder="Folder name" maxLength={255} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={create}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? "Creating..." : "Create Folder"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FolderActions({ itemType, itemId, itemName, fileUrl }: { itemType: ItemType; itemId: number; itemName: string; fileUrl?: string }) {
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [rename, setRename] = useState(itemName);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const downloadFile = async () => {
    if (itemType !== "file" || !fileUrl || busy || deleteBusy) return;
    setBusy(true);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = itemName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteFile = async () => {
    if (itemType !== "file" || deleteBusy || busy) return;
    if (!window.confirm(`Delete "${itemName}"? This will remove the file from storage.`)) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/files/${itemId}`, { method: "DELETE" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.detail || json.error || "Delete failed");
      await queryClient.invalidateQueries({ queryKey: ["folder-browser"] });
      await queryClient.invalidateQueries({ queryKey: ["folder-actions"] });
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  const renameFolder = async () => {
    const value = rename.trim();
    if (!value) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/folders/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.detail || json.error || "Rename failed");
      await queryClient.invalidateQueries({ queryKey: ["folder-browser"] });
      setRenameOpen(false);
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${itemName}`} onClick={(event) => event.stopPropagation()}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {itemType === "folder" && <DropdownMenuItem onSelect={() => { setRename(itemName); setRenameOpen(true); }}><Pencil />Rename</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setMoveOpen(true)}><Move />Move</DropdownMenuItem>
          {itemType === "file" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy || deleteBusy || !fileUrl} onSelect={downloadFile}><Download />Download</DropdownMenuItem>
              <DropdownMenuItem disabled={busy || deleteBusy} onSelect={deleteFile} className="text-destructive focus:text-destructive"><Trash2 />Delete</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {itemType === "folder" && (
        <Dialog open={renameOpen} onOpenChange={(value) => !busy && setRenameOpen(value)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Folder</DialogTitle>
              <DialogDescription>Rename the folder without changing its ID or contents.</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={rename} onChange={(event) => setRename(event.target.value)} onKeyDown={(event) => event.key === "Enter" && renameFolder()} maxLength={255} />
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button disabled={busy} onClick={renameFolder}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <MoveDestinationPicker open={moveOpen} onOpenChange={setMoveOpen} itemType={itemType} itemId={itemId} itemName={itemName} />
    </>
  );
}
