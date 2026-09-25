"use client";

import { useEffect, useState } from "react";
import { FileText, File, Image as ImageIcon, Video } from "lucide-react";

type SharedFile = { id: number; name: string; path: string; mimeType: string; size: number; url: string; createdAt: string };
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

  useEffect(() => {
    params.then(({ token }) =>
      fetch(`/api/shared/folders/${encodeURIComponent(token)}`)
        .then(async (response) => {
          const json = await response.json();
          if (!response.ok) throw new Error(json.error || "Share link is unavailable");
          setData(json);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Share link is unavailable"))
    );
  }, [params]);

  if (error) return <main className="flex min-h-screen items-center justify-center p-6"><div className="rounded-2xl border p-8 text-center"><h1 className="text-xl font-semibold">Folder unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p></div></main>;
  if (!data) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">Loading shared folder…</main>;

  return <main className="min-h-screen bg-background p-6 md:p-10">
    <div className="mx-auto max-w-6xl">
      <div className="mb-8"><p className="text-sm text-muted-foreground">Shared folder</p><h1 className="mt-1 text-3xl font-semibold">{data.folder.name}</h1><p className="mt-2 text-sm text-muted-foreground">{data.files.length} files · {formatBytes(data.files.reduce((sum, file) => sum + file.size, 0))}</p></div>
      {data.files.length === 0 ? <div className="rounded-2xl border p-12 text-center text-muted-foreground">This folder has no active files.</div> :
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {data.files.map((file) => {
            const image = file.mimeType.startsWith("image/");
            const video = file.mimeType.startsWith("video/");
            const Icon = file.mimeType.startsWith("text/") ? FileText : File;
            return <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border bg-card transition hover:shadow-lg">
              <div className="flex aspect-square items-center justify-center bg-muted/30">{image ? <img src={file.url} alt={file.name} loading="lazy" className="h-full w-full object-cover" /> : video ? <Video className="h-12 w-12 text-muted-foreground" /> : <Icon className="h-12 w-12 text-muted-foreground" />}</div>
              <div className="p-3"><div className="truncate text-sm font-medium">{file.name}</div>{file.path && <div className="truncate text-xs text-muted-foreground">{file.path}</div>}<div className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</div></div>
            </a>;
          })}
        </div>}
    </div>
  </main>;
}
