"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ChevronRight, Download, FileArchive, FileCode2, FileText, Folder,
  FolderOpen, Grid2X2, Image as ImageIcon, List, Play, Search, Video,
  FileSpreadsheet, File, Link2, Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaLightbox } from "@/components/media/media-lightbox";
import type { MediaFile } from "@/components/media/media-card";
import { formatBytes, formatDate, isVideoMime } from "@/lib/format";
import { cn } from "@/lib/utils";

type FolderRow = {
  id: number; name: string; parentId: number | null;
  childFolderCount: number; fileCount: number;
  totalFileCount?: number; totalFolderCount?: number; totalSize?: number;
  lastModified?: string;
};

type FileRow = MediaFile & { thumbnailPublicId?: string | null };

type ViewMode = "grid" | "list";

function iconFor(mime: string) {
  if (mime.includes("pdf")) return FileText;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return FileSpreadsheet;
  if (mime.includes("zip") || mime.includes("archive") || mime.includes("compressed")) return FileArchive;
  if (mime.includes("javascript") || mime.includes("typescript") || mime.includes("json") || mime.includes("xml") || mime.includes("css") || mime.includes("html")) return FileCode2;
  if (mime.startsWith("text/")) return FileText;
  return File;
}

function FolderCard({ folder, onOpen }: { folder: FolderRow; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group rounded-2xl border border-border/70 bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
      <div className="mb-4 flex items-start justify-between">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><FolderOpen className="h-7 w-7" /></div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <div className="truncate font-semibold">{folder.name}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {(folder.totalFileCount ?? folder.fileCount)} files · {(folder.totalFolderCount ?? folder.childFolderCount)} folders
      </div>
      <div className="mt-1 text-sm font-medium">{formatBytes(folder.totalSize ?? 0)}</div>
      {folder.lastModified && <div className="mt-2 text-[11px] text-muted-foreground">Updated {formatDate(folder.lastModified)}</div>}
    </button>
  );
}

function FileCard({ file, onOpen }: { file: FileRow; onOpen: () => void }) {
  const isImage = file.mimeType.startsWith("image/");
  const isVideo = isVideoMime(file.mimeType);
  const Icon = iconFor(file.mimeType);
  return (
    <div className="group overflow-hidden rounded-2xl border border-border/70 bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="aspect-square bg-muted/30">
          {isImage ? (
            <img src={file.publicUrl} alt={file.originalName} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : isVideo ? (
            <div className="relative flex h-full items-center justify-center"><Video className="h-12 w-12 text-muted-foreground/50" /><span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white"><Play className="mr-1 inline h-3 w-3 fill-current" />VIDEO</span></div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><Icon className="h-12 w-12" /><span className="max-w-[80%] truncate text-xs">{file.mimeType.split("/").pop()}</span></div>
          )}
        </div>
        <div className="p-3 pb-2">
          <div className="truncate text-sm font-medium">{file.originalName}</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)} · {formatDate(file.createdAt)}</div>
        </div>
      </button>
      <a href={`/api/files/${file.id}/download`} className="flex items-center justify-center gap-2 border-t border-border/70 px-3 py-2 text-xs font-medium hover:bg-muted/50">
        <Download className="h-3.5 w-3.5" />Download
      </a>
    </div>
  );
}

export default function FolderBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = Number(searchParams.get("folderId")) || null;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [openFile, setOpenFile] = useState<FileRow | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareRevoking, setShareRevoking] = useState(false);

  const shareQuery = useQuery<{ active: boolean }>({
    queryKey: ["folder-share", folderId],
    enabled: folderId !== null,
    queryFn: async () => {
      const response = await fetch(`/api/folders/${folderId}/share`);
      if (!response.ok) throw new Error("Failed to load share status");
      return response.json();
    },
  });
  const [deleteBusy, setDeleteBusy] = useState(false);

  const foldersQuery = useQuery<FolderRow[]>({
    queryKey: ["folder-browser", "folders"],
    queryFn: async () => {
      const r = await fetch("/api/folders?all=true");
      if (!r.ok) throw new Error("Failed to load folders");
      return (await r.json()).folders ?? [];
    },
  });

  const current = foldersQuery.data?.find((f) => f.id === folderId) ?? null;
  const childFolders = useMemo(
    () => (foldersQuery.data ?? []).filter((f) => f.parentId === folderId).filter((f) => f.name.toLowerCase().includes(search.toLowerCase())),
    [foldersQuery.data, folderId, search]
  );

  const filesQuery = useQuery<{ files: FileRow[]; total: number }>({
    queryKey: ["folder-browser", "files", folderId],
    enabled: folderId !== null,
    queryFn: async () => {
      const r = await fetch(`/api/files?folderId=${folderId}&status=active&sort=name&order=asc&limit=100`);
      if (!r.ok) throw new Error("Failed to load folder files");
      return r.json();
    },
  });

  const files = useMemo(
    () => (filesQuery.data?.files ?? []).filter((f) => f.originalName.toLowerCase().includes(search.toLowerCase())),
    [filesQuery.data?.files, search]
  );
  const visibleMedia = files.filter((f) => f.mimeType.startsWith("image/") || isVideoMime(f.mimeType));

  const path = useMemo(() => {
    const map = new Map((foldersQuery.data ?? []).map((f) => [f.id, f]));
    const result: FolderRow[] = [];
    let id = folderId;
    const seen = new Set<number>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const f = map.get(id);
      if (!f) break;
      result.unshift(f);
      id = f.parentId;
    }
    return result;
  }, [foldersQuery.data, folderId]);

  const generateShareLink = async () => {
    if (!current || shareBusy) return;
    setShareBusy(true);
    setShareCopied(false);
    try {
      const response = await fetch(`/api/folders/${current.id}/share`, { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.error || "Failed to generate share link");
      await navigator.clipboard.writeText(json.url);
      setShareCopied(true);
      await shareQuery.refetch();
      window.setTimeout(() => setShareCopied(false), 2500);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to generate share link");
    } finally {
      setShareBusy(false);
    }
  };

  const revokeShareLink = async () => {
    if (!current || shareRevoking) return;
    if (!window.confirm("Revoke the current share link? Existing files and the folder will remain intact.")) return;
    setShareRevoking(true);
    try {
      const response = await fetch(`/api/folders/${current.id}/share`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.error || "Failed to revoke share link");
      await shareQuery.refetch();
      setShareCopied(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to revoke share link");
    } finally {
      setShareRevoking(false);
    }
  };

  const deleteCurrentFolder = async () => {
    if (!current || deleteBusy) return;
    if (!window.confirm(`Delete folder "${current.name}" and all files inside it? This cannot be undone.`)) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/folders/${current.id}`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.error || "Failed to delete folder");
      await foldersQuery.refetch();
      go(current.parentId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete folder");
    } finally {
      setDeleteBusy(false);
    }
  };

  const go = (id: number | null) => {
    router.push(id ? `/folders?folderId=${id}` : "/folders");
  };

  const loading = foldersQuery.isLoading || (folderId !== null && filesQuery.isLoading);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button onClick={() => go(null)} className="hover:text-foreground">Home</button>
            {path.map((f) => <span key={f.id} className="flex items-center gap-2"><ChevronRight className="h-3 w-3" /><button onClick={() => go(f.id)} className="max-w-40 truncate hover:text-foreground">{f.name}</button></span>)}
          </div>
          <h1 className="mt-2 text-2xl font-semibold">{current?.name ?? "My Storage"}</h1>
          <p className="text-sm text-muted-foreground">{current ? `${current.totalFileCount ?? current.fileCount} files · ${formatBytes(current.totalSize ?? 0)}` : "Folders and media stored in your database."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current && <Button variant="outline" onClick={() => router.push(`/upload?folderId=${current.id}`)}><Folder className="mr-2 h-4 w-4" />Upload Files</Button>}
          <Button variant="outline" onClick={() => router.push("/folders?upload=1")}><FolderOpen className="mr-2 h-4 w-4" />Upload Folder</Button>
          {current && <Button variant="outline" asChild><a href={`/api/folders/${current.id}/download`}><Download className="mr-2 h-4 w-4" />Download Folder</a></Button>}
          {current && <Button variant="outline" onClick={generateShareLink} disabled={shareBusy}><Link2 className="mr-2 h-4 w-4" />{shareBusy ? "Generating…" : shareCopied ? "Link Copied" : shareQuery.data?.active ? "Generate New Link" : "Create Share Link"}</Button>}
          {current && shareQuery.data?.active && <Button variant="outline" onClick={revokeShareLink} disabled={shareRevoking}><Trash2 className="mr-2 h-4 w-4" />{shareRevoking ? "Revoking…" : "Revoke Share"}</Button>}
          {current && <Button variant="destructive" onClick={deleteCurrentFolder} disabled={deleteBusy}><Trash2 className="mr-2 h-4 w-4" />{deleteBusy ? "Deleting…" : "Delete Folder"}</Button>}
        </div>
      </div>

      {folderId !== null && <Button variant="ghost" size="sm" onClick={() => go(current?.parentId ?? null)}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>}

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${current ? "this folder" : "folders"}…`} className="pl-9" /></div>
        <div className="flex rounded-lg border p-1">
          <Button variant={view === "grid" ? "secondary" : "ghost"} size="sm" onClick={() => setView("grid")}><Grid2X2 className="h-4 w-4" /></Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setView("list")}><List className="h-4 w-4" /></Button>
        </div>
      </div>

      {loading ? <div className="rounded-2xl border p-12 text-center text-sm text-muted-foreground">Loading storage…</div> : (
        <>
          {childFolders.length > 0 && <section className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Folders</h2><div className={cn(view === "grid" ? "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "space-y-2")}>{childFolders.map((f) => view === "grid" ? <FolderCard key={f.id} folder={f} onOpen={() => go(f.id)} /> : <button key={f.id} onClick={() => go(f.id)} className="flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:bg-muted/40"><Folder className="h-5 w-5 text-primary" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-muted-foreground">{f.totalFileCount ?? f.fileCount} files · {formatBytes(f.totalSize ?? 0)}</span></button>)}</div></section>}

          {folderId !== null && files.length > 0 && <section className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Files</h2>{view === "grid" ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{files.map((f) => <FileCard key={f.id} file={f} onOpen={() => setOpenFile(f)} />)}</div> : <div className="divide-y rounded-xl border">{files.map((f) => <div key={f.id} className="flex items-center gap-3 p-3 hover:bg-muted/40"><button type="button" onClick={() => setOpenFile(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">{f.mimeType.startsWith("image/") ? <ImageIcon className="h-5 w-5" /> : <File className="h-5 w-5" />}</div><span className="truncate text-sm">{f.originalName}</span><span className="hidden text-xs text-muted-foreground sm:inline">{f.mimeType.split("/").pop()}</span><span className="hidden w-20 text-right text-xs text-muted-foreground sm:inline">{formatBytes(f.size)}</span></button><a href={`/api/files/${f.id}/download`} className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Download</span></a></div>)}</div>}</section>}

          {folderId !== null && !childFolders.length && !files.length && <div className="rounded-2xl border p-12 text-center"><Folder className="mx-auto h-12 w-12 text-muted-foreground/40" /><h3 className="mt-3 font-medium">This folder is empty</h3><p className="mt-1 text-sm text-muted-foreground">Upload files to this folder to get started.</p></div>}
          {folderId === null && !childFolders.length && <div className="rounded-2xl border p-12 text-center"><Folder className="mx-auto h-12 w-12 text-muted-foreground/40" /><h3 className="mt-3 font-medium">No folders yet</h3></div>}
        </>
      )}

      <MediaLightbox file={openFile} siblings={visibleMedia.map((f) => f.id)} open={!!openFile} onClose={() => setOpenFile(null)} onNavigate={(id) => setOpenFile(visibleMedia.find((f) => f.id === id) ?? null)} />
    </div>
  );
}
