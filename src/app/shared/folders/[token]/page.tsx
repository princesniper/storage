"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, File, FileText, Video, X } from "lucide-react";

type SharedFile = {
  id: number;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  url: string;
  downloadUrl: string;
  createdAt: string;
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

  const totalSize = useMemo(() => data?.files.reduce((sum, file) => sum + file.size, 0) ?? 0, [data]);
  const preview = previewIndex !== null ? data?.files[previewIndex] ?? null : null;
  const goPrev = () => {
    if (previewIndex !== null && previewIndex > 0) setPreviewIndex(previewIndex - 1);
  };
  const goNext = () => {
    if (previewIndex !== null && data && previewIndex < data.files.length - 1) setPreviewIndex(previewIndex + 1);
  };

  if (error) return <main className="flex min-h-screen items-center justify-center p-6"><div className="rounded-2xl border p-8 text-center"><h1 className="text-xl font-semibold">Folder unavailable</h1><p className="mt-2 text-sm text-muted-foreground">This share link is invalid, expired, or revoked.</p></div></main>;
  if (!data) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">Loading shared folder…</main>;

  return <main className="min-h-screen bg-background p-4 md:p-10">
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="text-sm text-muted-foreground">Shared folder</p><h1 className="mt-1 text-3xl font-semibold">{data.folder.name}</h1><p className="mt-2 text-sm text-muted-foreground">{data.files.length} files · {formatBytes(totalSize)}</p></div>
        <a href={`/api/shared/folders/${encodeURIComponent(token)}/download`} className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"><Download className="mr-2 h-4 w-4" />Download folder</a>
      </div>
      {data.files.length === 0 ? <div className="rounded-2xl border p-12 text-center text-muted-foreground">This folder has no active files.</div> :
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {data.files.map((file) => {
            const image = file.mimeType.startsWith("image/");
            const video = file.mimeType.startsWith("video/");
            const Icon = file.mimeType.startsWith("text/") ? FileText : File;
            return <div key={file.id} className="overflow-hidden rounded-2xl border bg-card">
              <button type="button" onClick={() => setPreviewIndex(data.files.findIndex((item) => item.id === file.id))} className="block w-full text-left">
                <div className="flex aspect-square items-center justify-center bg-muted/30">{image ? <img src={file.url} alt={file.name} loading="lazy" className="h-full w-full object-cover" /> : video ? <video src={file.url} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : <Icon className="h-12 w-12 text-muted-foreground" />}</div>
                <div className="p-3"><div className="truncate text-sm font-medium">{file.name}</div>{file.path && <div className="truncate text-xs text-muted-foreground">{file.path}</div>}<div className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</div></div>
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
        {previewIndex !== null && data && previewIndex < data.files.length - 1 && <button type="button" onClick={goNext} className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/70 p-2 text-white hover:bg-black" aria-label="Next file"><ChevronRight className="h-6 w-6" /></button>}
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
        {data && data.files.length > 1 && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">{(previewIndex ?? 0) + 1} / {data.files.length}</div>}
      </div>
    </div>}
  </main>;
}
