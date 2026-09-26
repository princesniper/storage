"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FolderBrowser from "@/components/folders/folder-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Folder, FolderUp, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

type FolderItem = {
  id: number;
  name: string;
  parentId: number | null;
  childFolderCount: number;
  fileCount: number;
};

type UploadItem = {
  id: string;
  file: File;
  relativePath: string;
  folderPath: string;
  status: "pending" | "uploading" | "success" | "failed";
  progress: number;
  loadedBytes: number;
  speedBps: number;
  telegramProgress: number;
  telegramSpeedBps: number;
  stage: "browser" | "telegram" | "processing" | "complete";
  error?: string;
  url?: string;
};

type Entry = FileSystemEntry & { isFile: boolean; isDirectory: boolean; name: string };
type FileEntry = FileSystemFileEntry & { file: (cb: (file: File) => void, err?: (e: DOMException) => void) => void };
type DirEntry = FileSystemDirectoryEntry & { createReader: () => FileSystemDirectoryReader };

// Telegram MTProto uploads are intentionally serialized. Browser-side parallel
// uploads can trigger Telegram flood limits and turn a healthy upload into 502s.
const CONCURRENCY = 1;

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
}

function makeUploadId(path: string, file: File): string {
  return `${path}::${file.size}::${file.lastModified}`;
}

function rootAndFolderPath(path: string) {
  const parts = normalizeRelativePath(path).split("/");
  const root = parts[0] ?? fileNameFallback();
  return { root, folderPath: parts.slice(0, -1).join("/") };
}

function fileNameFallback() {
  return "Uploaded Folder";
}

async function collectDirectory(entry: DirEntry, prefix = ""): Promise<File[]> {
  const reader = entry.createReader();
  const files: File[] = [];
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  while (true) {
    const entries = await readBatch();
    if (!entries.length) break;
    for (const raw of entries) {
      const child = raw as Entry;
      const childPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (child as FileEntry).file(resolve, reject)
        );
        Object.defineProperty(file, "relativePath", { value: childPath, configurable: true });
        files.push(file);
      } else if (child.isDirectory) {
        files.push(...await collectDirectory(child as DirEntry, childPath));
      }
    }
  }
  return files;
}

async function collectDroppedFiles(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() as Entry | null;
    if (entry?.isDirectory) {
      out.push(...await collectDirectory(entry as DirEntry));
    } else {
      const file = item.getAsFile();
      if (file) {
        Object.defineProperty(file, "relativePath", { value: file.name, configurable: true });
        out.push(file);
      }
    }
  }
  return out;
}

function getRelativePath(file: File): string {
  const candidate = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizeRelativePath(candidate || (file as File & { relativePath?: string }).relativePath || file.name);
}

function progressFor(items: UploadItem[]) {
  const total = items.length;
  const uploaded = items.filter((i) => i.status === "success").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0);
  const uploadedBytes = items.reduce(
    (sum, i) => sum + (i.status === "success" ? i.file.size : i.status === "uploading" ? i.loadedBytes : 0),
    0
  );
  const active = items.filter((i) => i.status === "uploading");
  const percent = totalBytes ? Math.min(100, Math.floor((uploadedBytes / totalBytes) * 100)) : 0;
  const speedBps = active.reduce((sum, i) => sum + i.speedBps, 0);
  const remainingBytes = Math.max(0, totalBytes - uploadedBytes);
  const etaSeconds = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : null;
  return { total, uploaded, failed, percent, totalBytes, uploadedBytes, speedBps, etaSeconds };
}

function FolderTree({
  folders,
  childrenByParent,
  depth = 0,
}: {
  folders: FolderItem[];
  childrenByParent: Map<number | null, FolderItem[]>;
  depth?: number;
}) {
  return (
    <div className="space-y-1">
      {folders.map((folder) => (
        <div key={folder.id}>
          <button
            onClick={() => window.location.assign(`/files?folderId=${folder.id}`)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted/40"
            style={{ paddingLeft: 12 + depth * 22 }}
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sm">{folder.name}</span>
            <span className="text-[11px] text-muted-foreground">{folder.fileCount} files</span>
          </button>
          <FolderTree folders={childrenByParent.get(folder.id) ?? []} childrenByParent={childrenByParent} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

export default function FoldersClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState("");
  const [rootName, setRootName] = useState("");
  const [rootId, setRootId] = useState<number | null>(null);
  const [channelId, setChannelId] = useState("");
  const folderIdsRef = useRef<Record<string, number> | null>(null);

  const { data: channels = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["storage-channels"],
    queryFn: async () => {
      const r = await fetch("/api/channels");
      if (!r.ok) throw new Error("Failed to load storage channels");
      const json = await r.json();
      return (json.channels ?? []).filter((c: { status?: string }) => c.status !== "inactive");
    },
  });

  const router = useRouter();
  const searchParams = useSearchParams();
  const uploadMode = searchParams.get("upload") === "1";
  const stats = useMemo(() => progressFor(items), [items]);
  const failedItems = useMemo(() => items.filter((i) => i.status === "failed"), [items]);
  const currentItem = useMemo(() => items.find((i) => i.status === "uploading") ?? null, [items]);

  const patch = (id: string, value: Partial<UploadItem>) =>
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...value } : item));

  function clearUpload() {
    if (uploading) return;
    setItems([]);
    setRootName("");
    setRootId(null);
    folderIdsRef.current = null;
    setCurrent("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function addFiles(files: File[]) {
    const mapped = files
      .map((file) => {
        const relativePath = getRelativePath(file);
        const { root, folderPath } = rootAndFolderPath(relativePath);
        return {
          id: makeUploadId(relativePath, file),
          file,
          relativePath,
          folderPath,
          status: "pending" as const,
          progress: 0,
          loadedBytes: 0,
          speedBps: 0,
          telegramProgress: 0,
          telegramSpeedBps: 0,
          stage: "browser",
        };
      })
      .filter((item) => item.relativePath.split("/").length >= 2);

    if (!mapped.length) {
      toast({ title: "No folder detected", description: "Select or drop a complete folder, not an individual file.", variant: "destructive" });
      return;
    }

    const detectedRoot = rootAndFolderPath(mapped[0].relativePath).root;
    const sameRoot = mapped.filter((i) => rootAndFolderPath(i.relativePath).root === detectedRoot);
    if (sameRoot.length !== mapped.length) {
      toast({ title: "One folder at a time", description: "Please select or drop one root folder per upload.", variant: "destructive" });
      return;
    }

    setItems(sameRoot);
    setRootName(detectedRoot);
    setRootId(null);
    folderIdsRef.current = null;
    setCurrent("");
  }

  const onSelectFolder = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
  };

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    try {
      const files = await collectDroppedFiles(event.dataTransfer.items);
      addFiles(files);
    } catch (error) {
      toast({ title: "Folder scan failed", description: error instanceof Error ? error.message : "Could not read the dropped folder.", variant: "destructive" });
    }
  };

  async function createTree() {
    const paths = new Set<string>([rootName]);
    for (const item of items) {
      const parts = item.folderPath.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i += 1) paths.add(parts.slice(0, i).join("/"));
    }
    const response = await fetch("/api/folders/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootName, folderPaths: [...paths] }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Folder tree creation failed");
    setRootId(json.rootId);
    return json.folderIds as Record<string, number>;
  }

  function uploadOne(item: UploadItem, folderIds: Record<string, number>, attempt = 0): Promise<void> {
    return new Promise((resolve) => {
      const folderId = folderIds[item.folderPath];
      if (!folderId) {
        patch(item.id, { status: "failed", error: "FOLDER_NOT_RESOLVED" });
        resolve();
        return;
      }
      setCurrent(item.relativePath);
      patch(item.id, { status: "uploading", progress: 0, loadedBytes: 0, speedBps: 0, telegramProgress: 0, telegramSpeedBps: 0, stage: "browser", error: undefined });
      const xhr = new XMLHttpRequest();
      const uploadId = crypto.randomUUID();
      let telegramTimer: number | null = null;
      let lastTelegramProgress = 0;
      let lastTelegramAt = performance.now();
      const startedAt = performance.now();
      let lastLoaded = 0;
      let lastSampleAt = startedAt;
      let smoothedSpeed = 0;
      const fd = new FormData();
      fd.append("file", item.file, item.file.name);
      fd.append("storageChannelId", channelId);
      fd.append("folderId", String(folderId));
      fd.append("relativePath", item.relativePath);

      const stopTelegramPolling = () => {
        if (telegramTimer !== null) window.clearInterval(telegramTimer);
        telegramTimer = null;
      };
      const startTelegramPolling = () => {
        patch(item.id, { stage: "telegram", progress: 50, speedBps: 0 });
        const poll = async () => {
          try {
            const response = await fetch(`/api/status?uploadId=${encodeURIComponent(uploadId)}`, { cache: "no-store" });
            const json = await response.json();
            const state = json.upload;
            if (!state) return;
            const now = performance.now();
            const deltaSeconds = Math.max((now - lastTelegramAt) / 1000, 0.1);
            const deltaProgress = Math.max(0, state.progress - lastTelegramProgress);
            const telegramSpeedBps = (deltaProgress / 100) * item.file.size / deltaSeconds;
            patch(item.id, {
              telegramProgress: state.progress,
              telegramSpeedBps: Number.isFinite(telegramSpeedBps) ? telegramSpeedBps : 0,
              speedBps: Number.isFinite(telegramSpeedBps) ? telegramSpeedBps : 0,
              stage: state.stage === "complete" ? "processing" : "telegram",
              progress: state.stage === "complete" ? 98 : Math.min(95, 50 + Math.floor(state.progress * 0.45)),
            });
            lastTelegramProgress = state.progress;
            lastTelegramAt = now;
          } catch {
            // The upload request itself remains authoritative; polling failure
            // must never turn a successful Telegram upload into a client error.
          }
        };
        void poll();
        telegramTimer = window.setInterval(poll, 500);
      };

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const now = performance.now();
          const sampleSeconds = Math.max((now - lastSampleAt) / 1000, 0.05);
          const sampleBytes = Math.max(0, event.loaded - lastLoaded);
          const instantSpeed = sampleBytes / sampleSeconds;
          smoothedSpeed = smoothedSpeed === 0 ? instantSpeed : (smoothedSpeed * 0.7) + (instantSpeed * 0.3);
          lastLoaded = event.loaded;
          lastSampleAt = now;
          patch(item.id, {
            progress: Math.min(50, Math.floor((event.loaded / event.total) * 50)),
            loadedBytes: event.loaded,
            speedBps: smoothedSpeed,
          });
        }
      };
      xhr.onload = () => {
        stopTelegramPolling();
        let json: any = {};
        try { json = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && json.success) {
          patch(item.id, { status: "success", progress: 100, loadedBytes: item.file.size, speedBps: 0, url: json.file?.url });
          resolve();
          return;
        }
        if (xhr.status === 429 && attempt < 2 && !abortRef.current) {
          window.setTimeout(() => uploadOne(item, folderIds, attempt + 1).then(resolve), 1000 * (attempt + 1));
          return;
        }
        const detail = typeof json.detail === "string" && json.detail.trim() ? ` — ${json.detail.trim()}` : "";
        patch(item.id, { status: "failed", error: `${json.error || `HTTP_${xhr.status}`}${detail}` });
        resolve();
      };
      xhr.onerror = () => { stopTelegramPolling(); patch(item.id, { status: "failed", error: "NETWORK_ERROR" }); resolve(); };
      xhr.onabort = () => { stopTelegramPolling(); patch(item.id, { status: "failed", error: "CANCELLED" }); resolve(); };
      xhr.open("POST", "/api/files/upload");
      xhr.setRequestHeader("X-Upload-Id", uploadId);
      xhr.upload.addEventListener("load", startTelegramPolling, { once: true });
      xhr.send(fd);
    });
  }

  async function runQueue(retryOnly = false) {
    const queue = items.filter((i) => retryOnly ? i.status === "failed" : i.status !== "success");
    if (!queue.length) return;
    if (!channelId) {
      toast({ title: "Select a Telegram channel first", description: "Choose an active storage channel.", variant: "destructive" });
      return;
    }
    abortRef.current = false;
    setUploading(true);
    try {
      let resolved = folderIdsRef.current;
      if (!resolved) {
        resolved = await createTree();
        folderIdsRef.current = resolved;
      }
      if (!resolved[rootName]) throw new Error("Root folder was not resolved");
      const work = [...queue];
      const workers = Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
        while (work.length && !abortRef.current) {
          const item = work.shift();
          if (item) await uploadOne(item, resolved);
        }
      });
      await Promise.all(workers);
      await qc.invalidateQueries({ queryKey: ["folders"] });
    } catch (error) {
      toast({ title: "Folder upload stopped", description: error instanceof Error ? error.message : "Unexpected error", variant: "destructive" });
    } finally {
      setUploading(false);
      setCurrent("");
    }
  }

  return (
    <div className="space-y-6">
      <FolderBrowser />
      {uploadMode && (
        <section className="mx-6 mb-6 space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Upload Folder</h2>
              <p className="text-sm text-muted-foreground">Select or drop one complete folder. Its hierarchy will be preserved.</p>
            </div>
            <Button variant="ghost" onClick={() => router.push("/folders")} disabled={uploading}>Close</Button>
          </div>

          <input ref={inputRef} type="file" className="hidden" onChange={onSelectFolder} disabled={uploading} {...({ webkitdirectory: "", directory: "" } as any)} />

          <div className="flex max-w-xl flex-col gap-2">
            <label className="text-sm font-medium">Storage Destination</label>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={uploading} className="h-10 rounded-md border bg-background px-3 text-sm">
              <option value="">Select Telegram channel…</option>
              {channels.map((channel) => <option key={channel.id} value={String(channel.id)}>{channel.name}</option>)}
            </select>
          </div>

          <div onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} className={cn("rounded-2xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer", dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
            <UploadCloud className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <div className="font-medium">{dragOver ? "Drop folder here" : "Drag & drop a complete desktop folder here"}</div>
            <div className="mt-1 text-sm text-muted-foreground">Nested folders are created automatically.</div>
          </div>

          {items.length > 0 && (
            <div className="space-y-4 rounded-2xl border p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">Uploading folder: {rootName}</div>
                  <div className="text-sm text-muted-foreground">
                    {stats.uploaded} / {stats.total} files · {stats.failed} failed · {formatBytes(stats.uploadedBytes)} / {formatBytes(stats.totalBytes)}
                  </div>
                </div>
                <div className="text-2xl font-semibold tabular-nums">{stats.percent}%</div>
              </div>
              <Progress value={stats.percent} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Transfer speed: {stats.speedBps > 0 ? formatBytes(stats.speedBps) + "/s" : "—"}</span>
                <span>ETA: {stats.etaSeconds !== null ? Math.floor(stats.etaSeconds / 60) + "m " + (stats.etaSeconds % 60) + "s" : "Calculating…"}</span>
                <span>{currentItem ? (currentItem.stage === "browser" ? "Browser → server" : currentItem.stage === "telegram" ? "Server → Telegram" : "Finalizing upload") : "—"}</span>
              </div>
              {currentItem && (
                <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{currentItem.relativePath}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{currentItem.progress}%</span>
                  </div>
                  <Progress value={currentItem.progress} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatBytes(currentItem.loadedBytes)} / {formatBytes(currentItem.file.size)}</span>
                    <span>{currentItem.stage === "browser"
  ? (currentItem.speedBps > 0 ? formatBytes(currentItem.speedBps) + "/s" : "Starting…")
  : currentItem.stage === "telegram"
    ? (currentItem.telegramSpeedBps > 0 ? formatBytes(currentItem.telegramSpeedBps) + "/s" : "Connecting…")
    : currentItem.stage === "processing" ? "Finalizing…" : "Complete"}</span>
                  </div>
                </div>
              )}
              {current && !currentItem && <div className="text-xs text-muted-foreground truncate">Current: {current}</div>}
              {failedItems.length > 0 && !uploading && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <div className="font-medium">Failed files</div>
                  <div className="mt-2 space-y-1 text-sm">{failedItems.map((item) => <div key={item.id}>{item.relativePath} <span className="text-xs text-muted-foreground">({item.error})</span></div>)}</div>
                  <Button className="mt-3" size="sm" onClick={() => runQueue(true)}><RotateCcw className="mr-2 h-4 w-4" />Retry Failed</Button>
                </div>
              )}
              {!uploading && stats.uploaded < stats.total && failedItems.length === 0 && <Button onClick={() => runQueue(false)}><UploadCloud className="mr-2 h-4 w-4" />Start Upload</Button>}
              {uploading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{currentItem && currentItem.loadedBytes >= currentItem.file.size ? "Transfer complete — uploading to Telegram…" : `Transferring to server with ${CONCURRENCY} concurrent worker${CONCURRENCY === 1 ? "" : "s"}…`}</div>}
              {!uploading && <Button variant="outline" onClick={clearUpload}>Clear</Button>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
