"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, File, FileText, Video, X } from "lucide-react";
import { FOLDER_MIME_OPTIONS, FOLDER_SORT_OPTIONS, sortByMetadata, type FolderSortKey } from "@/lib/folder-sorting";

type SharedFile = {
  id: number;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  url: string;
  downloadUrl: string;
  createdAt: string;
  lastModified?: string;
};
type SharedData = { folder: { id: number; name: string }; files: SharedFile[] };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export default function SharedFolderPage({ params }: { params: Promise<{ token: string }> }) {
  const [data, setData] = useState<SharedData | null>(null);
  const [error, setError] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [token, setToken] = useState("");
  const [sort, setSort] = useState<FolderSortKey>("created:desc");
  const [search, setSearch] = useState("");
  const [mimeType, setMimeType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const swipeStartX = useRef<number | null>(null);

  useEffect(() => {
    params.then(({ token: value }) => {
      setToken(value);
      fetch(`/api/shared/folders/${encodeURIComponent(value)}`)
        .then(async (response) => {
          const json = await response.json();
          if (!response.ok) throw new Error("Share link is unavailable");
          setData(json);
        })
        .catch(() => setError("Share link is unavailable"));
    });
  }, [params]);

  const filteredFiles = useMemo(() => (data?.files ?? []).filter((file) => {
    const query = search.trim().toLocaleLowerCase();
    if (query && !`${file.name} ${file.path}`.toLocaleLowerCase().includes(query)) return false;
    if (mimeType !== "all" && file.mimeType !== mimeType) return false;
    const created = new Date(file.createdAt).getTime();
    if (from && (!Number.isFinite(created) || created < new Date(from).getTime())) return false;
    if (to && (!Number.isFinite(created) || created > new Date(`${to}T23:59:59.999`).getTime())) return false;
    return true;
  }), [data, search, mimeType, from, to]);
  const sortedFiles = useMemo(() => sortByMetadata(filteredFiles, sort), [filteredFiles, sort]);
  const totalSize = useMemo(() => sortedFiles.reduce((sum, file) => sum + file.size, 0), [sortedFiles]);
  const hasActiveFilters = Boolean(search || mimeType !== "all" || from || to);
  const preview = previewIndex !== null ? sortedFiles[previewIndex] ?? null : null;
  const goPrev = () => {
    if (previewIndex !== null && previewIndex > 0) setPreviewIndex(previewIndex - 1);
  };
  const goNext = () => {
    if (previewIndex !== null && previewIndex < sortedFiles.length - 1) setPreviewIndex(previewIndex + 1);
  };

  if (error) return <main className="flex min-h-screen items-center justify-center p-6"><div className="rounded-2xl border p-8 text-center"><h1 className="text-xl font-semibold">Folder unavailable</h1><p className="mt-2 text-sm text-muted-foreground">This share link is invalid, expired, or revoked.</p></div></main>;
  if (!data) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">Loading shared folder…</main>;

  return <main className="min-h-screen p-4 md:p-10">
    <div className="mx-auto max-w-6xl">
      <div className="clay-panel mb-6 flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between md:p-6">
        <div><p className="text-sm text-muted-foreground">Shared folder</p><h1 className="type-h1 mt-1 break-words">{data.folder.name}</h1><p className="mt-2 text-sm text-muted-foreground">{filteredFiles.length} files · {formatBytes(totalSize)}</p></div>
        <a href={`/api/shared/folders/${encodeURIComponent(token)}/download`} className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"><Download className="mr-2 h-4 w-4" />Download folder</a>
      </div>
      <div className="clay-toolbar mb-5 space-y-3 p-3 md:p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center"><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPreviewIndex(null); }} placeholder="Search files by name or folder…" aria-label="Search shared files" className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"/><label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">Sort by<select aria-label="Sort shared files" value={sort} onChange={(event) => { setSort(event.target.value as FolderSortKey); setPreviewIndex(null); }} className="h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{FOLDER_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value==="created:desc"?"Newest first":option.value==="created:asc"?"Oldest first":option.value==="name:asc"?"Name A → Z":option.value==="name:desc"?"Name Z → A":option.label}</option>)}</select></label></div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center"><div className="flex flex-wrap items-center gap-2" aria-label="File type filter">{FOLDER_MIME_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={mimeType===option.value} onClick={() => { setMimeType(option.value); setPreviewIndex(null); }} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mimeType===option.value?"border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400":"border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{option.label}</button>)}</div><div className="flex flex-wrap items-center gap-2 xl:ml-auto"><label className="flex items-center gap-2 text-xs text-muted-foreground">From<input type="date" aria-label="From date" value={from} max={to||undefined} onChange={(event) => { setFrom(event.target.value); setPreviewIndex(null); }} className="h-9 w-[145px] rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"/></label><label className="flex items-center gap-2 text-xs text-muted-foreground">To<input type="date" aria-label="To date" value={to} min={from||undefined} onChange={(event) => { setTo(event.target.value); setPreviewIndex(null); }} className="h-9 w-[145px] rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"/></label>{hasActiveFilters&&<button type="button" onClick={() => { setSearch(""); setMimeType("all"); setFrom(""); setTo(""); setPreviewIndex(null); }} className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear</button>}</div></div>
      </div>
      {filteredFiles.length === 0 ? <div className="rounded-2xl border p-12 text-center text-muted-foreground">{hasActiveFilters ? "No files match these filters." : "This folder has no active files."}</div> :
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {sortedFiles.map((file) => {
            const image = file.mimeType.startsWith("image/");
            const video = file.mimeType.startsWith("video/");
            const Icon = file.mimeType.startsWith("text/") ? FileText : File;
            return <div key={file.id} className="clay-media-card overflow-hidden rounded-2xl border">
              <button type="button" onClick={() => setPreviewIndex(sortedFiles.findIndex((item) => item.id === file.id))} className="block w-full text-left">
                <div className="media-card__canvas flex aspect-square items-center justify-center bg-muted/30">{image ? <img src={file.url} alt={file.name} loading="lazy" className="h-full w-full object-cover" /> : video ? <video src={file.url} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : <Icon className="h-12 w-12 text-muted-foreground" />}</div>
                <div className="media-card__metadata p-3"><div className="truncate text-sm font-medium">{file.name}</div>{file.path && <div className="truncate text-xs text-muted-foreground">{file.path}</div>}<div className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</div></div>
              </button>
              <a href={file.downloadUrl} className="flex items-center gap-2 border-t px-3 py-2 text-xs font-medium hover:bg-muted"><Download className="h-3.5 w-3.5" />Download</a>
            </div>;
          })}
        </div>}
    </div>

    {preview && <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={() => setPreviewIndex(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setPreviewIndex(null);
        else if (event.key === "ArrowLeft") goPrev();
        else if (event.key === "ArrowRight") goNext();
      }}
      tabIndex={-1}
    >
      <div className="relative flex max-h-full max-w-6xl items-center justify-center rounded-2xl bg-black p-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setPreviewIndex(null)} className="absolute right-3 top-3 z-20 rounded-full bg-black/70 p-2 text-white" aria-label="Close preview"><X className="h-5 w-5" /></button>
        {previewIndex !== null && previewIndex > 0 && <button type="button" onClick={goPrev} className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/70 p-2 text-white hover:bg-black" aria-label="Previous file"><ChevronLeft className="h-6 w-6" /></button>}
        {previewIndex !== null && previewIndex < sortedFiles.length - 1 && <button type="button" onClick={goNext} className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/70 p-2 text-white hover:bg-black" aria-label="Next file"><ChevronRight className="h-6 w-6" /></button>}
        <div className="max-h-[85vh] max-w-[90vw] overflow-hidden rounded-xl">
          {preview.mimeType.startsWith("video/") ? (
            <video src={preview.url} controls autoPlay playsInline className="max-h-[85vh] max-w-[90vw] rounded-xl" />
          ) : preview.mimeType.startsWith("image/") ? (
            <img
              src={preview.url}
              alt={preview.name}
              draggable={false}
              onTouchStart={(event) => { swipeStartX.current = event.touches[0]?.clientX ?? null; }}
              onTouchEnd={(event) => {
                const start = swipeStartX.current;
                swipeStartX.current = null;
                const end = event.changedTouches[0]?.clientX ?? start;
                if (start === null || end === null) return;
                const delta = end - start;
                if (Math.abs(delta) < 60) return;
                if (delta > 0) goPrev();
                else goNext();
              }}
              className="max-h-[85vh] max-w-[90vw] select-none object-contain touch-pan-y"
            />
          ) : (
            <iframe src={preview.url} title={preview.name} className="h-[80vh] w-[80vw] rounded-xl bg-white" />
          )}
        </div>
        {sortedFiles.length > 1 && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">{(previewIndex ?? 0) + 1} / {sortedFiles.length}</div>}
      </div>
    </div>}
  </main>;
}
