"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileImage, X, CheckCircle2, Plus, AlertCircle, Film, Loader2, ExternalLink, CircleX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { CopyButton } from "@/components/ui/copy-button";
import { formatBytes, isVideoMime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChannelRow { id: number; name: string; }
interface ChannelList { channels: ChannelRow[]; }

// No app-level folder/batch storage cap. Upload concurrency is intentionally bounded
// to keep the browser and Telegram connection stable while allowing any number of files.
const CONCURRENCY = 3;
const MAX_RETRIES_ON_429 = 3;
const RETRY_WAIT_S = 5;

type ItemStatus = "pending" | "uploading" | "success" | "failed";

interface BatchItem {
  key: number;
  file: File;
  preview?: string; // object URL for image thumbnails
  progress: number;
  status: ItemStatus;
  url?: string;
  channelName?: string;
  error?: string;
  httpStatus?: number;
  retryNote?: string;
}

let keyCounter = 0;

/**
 * Phase D — calm, honest upload error copy (presentation only).
 * The raw backend code is preserved for support/debugging and rendered
 * as muted mono detail — never as the headline.
 */
function friendlyUploadError(raw: string, httpStatus?: number): string {
  const code = (raw ?? "").toUpperCase();
  if (code.includes("RATE_LIMIT")) return "Rate limited — backing off briefly, then retrying automatically.";
  if (code.includes("TELEGRAM_NOT_CONNECTED")) return "Storage is offline. Reconnect it in Settings, then retry.";
  if (code.includes("FILE_TOO_LARGE")) return "This file exceeds the size limit for its type. Split or compress it and retry.";
  if (code.includes("UNSUPPORTED_MIME") || code.includes("EMPTY_FILE")) return "This file type or empty file isn't supported for storage.";
  if (code.includes("CHANNEL_NOT_FOUND")) return "The selected storage channel is no longer available. Pick another destination.";
  if (httpStatus === 405) return "The upload endpoint refused the request. Check your connection and retry.";
  if (httpStatus === 502 || code.includes("UPLOAD_FAILED") || code.includes("STORAGE_UNAVAILABLE"))
    return "The storage backend is unreachable right now. Your file is safe — retry shortly.";
  if (code.includes("DB_WRITE_FAILED")) return "The file reached storage but wasn't registered. Retry the upload.";
  return "The upload didn't complete. Retry when ready.";
}

export default function UploadClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetFolderId = Number(searchParams.get("folderId")) || null;
  const { toast } = useToast();
  const [channelId, setChannelId] = useState<string>("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  const { data, isLoading: channelsLoading } = useQuery<ChannelList>({
    queryKey: ["channels-for-upload"],
    queryFn: async () => {
      const r = await fetch("/api/channels");
      if (!r.ok) throw new Error("Failed to load channels");
      return r.json();
    },
  });

  const channels = data?.channels?.filter((c) => c) ?? [];
  const activeChannels = channels;

  const addFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setBatchError(null);
    setItems((prev) => [
      ...prev,
      ...arr.map((f) => ({
        key: keyCounter++,
        file: f,
        preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
        progress: 0,
        status: "pending" as ItemStatus,
      })),
    ]);
  }, []);
  // Revoke object URLs on unmount to avoid leaking memory
  const itemsRef = useRef<BatchItem[]>([]);
  itemsRef.current = items;
  useEffect(() => {
    const snapshot = itemsRef;
    return () => {
      for (const i of snapshot.current) {
        if (i.preview) URL.revokeObjectURL(i.preview);
      }
    };
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
  };

  const removeItem = (key: number) => {
    setItems((prev) => {
      const target = prev.find((i) => i.key === key);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((i) => i.key !== key);
    });
  };

  const clearAll = () => {
    setItems((prev) => {
      for (const i of prev) if (i.preview) URL.revokeObjectURL(i.preview);
      return [];
    });
    setBatchError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const patchItem = (key: number, patch: Partial<BatchItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };

  function uploadOne(item: BatchItem, channel: string, attempt = 0): Promise<void> {
    return new Promise((resolve) => {
      patchItem(item.key, { status: "uploading", progress: 0, retryNote: undefined, error: undefined });
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("storageChannelId", channel);
      if (targetFolderId) fd.append("folderId", String(targetFolderId));

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && !abortRef.current) {
          patchItem(item.key, { progress: Math.round((e.loaded / e.total) * 100) });
        }
      });

      xhr.addEventListener("load", () => {
        if (abortRef.current) {
          patchItem(item.key, { status: "failed", error: "Cancelled." });
          resolve();
          return;
        }
        try {
          const json = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && json.success) {
            patchItem(item.key, {
              status: "success",
              progress: 100,
              url: json.file.url,
              channelName: json.file.channel?.name ?? "",
            });
            resolve();
          } else if (xhr.status === 429 && attempt < MAX_RETRIES_ON_429) {
            // Rate limited — countdown then retry
            let waited = 0;
            patchItem(item.key, { retryNote: `Rate limited, retrying in ${RETRY_WAIT_S}s` });
            const timer = setInterval(() => {
              waited += 1;
              const left = RETRY_WAIT_S - waited;
              if (abortRef.current) {
                clearInterval(timer);
                patchItem(item.key, { status: "failed", error: "Cancelled.", retryNote: undefined });
                resolve();
                return;
              }
              if (left <= 0) {
                clearInterval(timer);
                uploadOne(item, channel, attempt + 1).then(resolve);
              } else {
                patchItem(item.key, { retryNote: `Rate limited, retrying in ${left}s` });
              }
            }, 1000);
          } else {
            patchItem(item.key, { status: "failed", error: json.error ?? "Upload failed", httpStatus: xhr.status });
            resolve();
          }
        } catch {
          patchItem(item.key, { status: "failed", error: "INVALID_RESPONSE", httpStatus: xhr.status });
          resolve();
        }
      });

      xhr.addEventListener("error", () => {
        patchItem(item.key, { status: "failed", error: "NETWORK_ERROR" });
        resolve();
      });
      xhr.addEventListener("abort", () => {
        patchItem(item.key, { status: "failed", error: "Upload cancelled." });
        resolve();
      });

      xhr.open("POST", "/api/files/upload");
      xhr.send(fd);
    });
  }

  const startUpload = async () => {
    if (items.length === 0) return;
    if (!channelId) {
      toast({ title: "Choose a storage destination", description: "Pick a storage destination before uploading.", variant: "destructive" });
      return;
    }
    abortRef.current = false;
    setUploading(true);
    setBatchError(null);
    // Reset failed items to pending for re-run
    setItems((prev) => prev.map((i) => (i.status === "failed" ? { ...i, status: "pending" as ItemStatus, progress: 0, error: undefined } : i)));

    // Snapshot keys; queue with concurrency 3
    const snapshot = items.filter((i) => i.status !== "success");
    const queue = [...snapshot];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const next = queue.shift();
        if (!next) break;
        // Skip already-successful (re-run case handled by snapshot filter)
        await uploadOne(next, channelId);
      }
    });
    await Promise.all(workers);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const cancelAll = () => {
    abortRef.current = true;
    setUploading(false);
  };

  const succeeded = items.filter((i) => i.status === "success");
  const failed = items.filter((i) => i.status === "failed");
  const allDone = items.length > 0 && !uploading && items.every((i) => i.status === "success" || i.status === "failed");
  const singleMode = items.length === 1;

  const copyAll = () => {
    const urls = succeeded.map((i) => i.url).filter(Boolean).join("\n");
    if (!urls) return;
    navigator.clipboard.writeText(urls);
    toast({ title: "Copied", description: `${succeeded.length} URL(s) copied to clipboard.` });
  };

  const resetBatch = () => {
    abortRef.current = false;
    clearAll();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload Media"
        description="Add assets to your media infrastructure · no app-level batch or folder storage cap."
        actions={
          <Button size="sm" variant="outline" onClick={() => router.push("/files")}>
            View library
          </Button>
        }
      />

      {activeChannels.length === 0 && !channelsLoading && (
        <Alert>
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>No active storage channels</AlertTitle>
          <AlertDescription>
            Add a storage destination first before uploading.
            <Button size="sm" variant="link" onClick={() => router.push("/channels")}>
              Go to Storage Channels
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Step indicator */}
      <ol className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Upload steps">
        <StepDot n={1} label="Destination" done={!!channelId} />
        <span className="h-px flex-1 bg-border" aria-hidden />
        <StepDot n={2} label="Files" done={items.length > 0} />
        <span className="h-px flex-1 bg-border" aria-hidden />
        <StepDot n={3} label="Upload" done={allDone} />
      </ol>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channel">Storage Destination</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger id="channel">
              <SelectValue placeholder="Select destination…" />
            </SelectTrigger>
            <SelectContent>
              {activeChannels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ─── Drop zone ─── */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "relative border-2 border-dashed rounded-xl p-8 md:p-12 text-center overflow-hidden",
            "duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,border-color]",
            dragOver
              ? "border-emerald-500 bg-emerald-500/5"
              : "border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.02]"
          )}
        >
          {/* Radial glow on dragover */}
          {dragOver && (
            <div
              className="pointer-events-none absolute inset-0 rounded-xl"
              style={{ background: "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(34,197,94,0.08) 0%, transparent 70%)" }}
              aria-hidden
            />
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            onChange={onSelectFile}
            className="hidden"
            id="file-input"
            disabled={uploading}
            aria-label="Choose files to upload"
          />
          <label htmlFor="file-input" className="cursor-pointer flex flex-col items-center gap-2.5">
            <span className={cn(
              "size-14 rounded-2xl flex items-center justify-center duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,color]",
              dragOver ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              <Upload className="size-6" aria-hidden />
            </span>
            <span className="text-sm font-medium">
              {dragOver ? "Drop files to add them" : "Drop images or videos here or click to choose"}
            </span>
            <span className="text-xs text-muted-foreground">JPEG, PNG, WEBP, GIF, MP4, WEBM, MOV · Images max 50 MB · Videos max 100 MB</span>
          </label>
        </div>

        {batchError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{batchError}</AlertDescription>
          </Alert>
        )}

        {/* Per-file list */}
        {items.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {items.length} file{items.length > 1 ? "s" : ""} selected
              </span>
              {!uploading && (
                <Button size="sm" variant="ghost" onClick={clearAll}>
                  Clear all
                </Button>
              )}
            </div>
            {items.map((item) => (
              <div
                key={item.key}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card p-3 duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[border-color,background-color]",
                  item.status === "failed" ? "border-red-500/25" : "border-border"
                )}
              >
                {item.preview ? (
                  <img src={item.preview} alt="" className="size-12 rounded-lg object-cover shrink-0 bg-muted" />
                ) : isVideoMime(item.file.type) ? (
                  <span className="size-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Film className="size-5 text-muted-foreground" aria-hidden />
                  </span>
                ) : (
                  <span className="size-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <FileImage className="size-5 text-muted-foreground" aria-hidden />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium truncate">{item.file.name}</div>
                    <UploadStatusBadge status={item.status} />
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatBytes(item.file.size)} · {item.file.type || "unknown type"}
                  </div>
                  {(item.status === "uploading" || (item.status === "pending" && uploading)) && (
                    <div className="flex items-center gap-2 mt-2">
                      <Progress value={item.progress} className="flex-1" aria-label={`Upload progress for ${item.file.name}`} />
                      <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right">{item.progress}%</span>
                    </div>
                  )}
                  {item.retryNote && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">{item.retryNote}</div>
                  )}
                  {item.error && (
                    <div className="mt-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2.5 py-2">
                      <div className="text-xs text-foreground/90">{friendlyUploadError(item.error, item.httpStatus)}</div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {item.error}{item.httpStatus ? ` · HTTP ${item.httpStatus}` : ""}
                      </div>
                    </div>
                  )}
                  {item.status === "success" && item.url && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <code className="flex-1 text-xs px-2 py-1 bg-muted rounded-lg font-mono break-all truncate">
                        {item.url}
                      </code>
                      <CopyButton text={item.url} iconOnly label="Copy URL" className="size-7" onCopy={() => toast({ title: "Copied" })} />
                      <Button size="sm" variant="ghost" className="size-7 px-0" asChild>
                        <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.file.name} in new tab`}>
                          <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
                {!uploading && item.status !== "success" && (
                  <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => removeItem(item.key)} aria-label={`Remove ${item.file.name}`}>
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
                {item.status === "success" && <CheckCircle2 className="size-5 shrink-0 text-emerald-500 animate-success-pop" aria-hidden />}
              </div>
            ))}
          </div>
        )}

        {uploading && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">Uploading… {succeeded.length}/{items.length} done</span>
            <Button size="sm" variant="ghost" onClick={cancelAll}>Cancel</Button>
          </div>
        )}

        {/* ─── Single-file success card ─── */}
        {singleMode && succeeded.length === 1 && allDone && (
          <Card tier="informational" className="border-emerald-500/25 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-400 animate-success-pop" aria-hidden />
                Media ready
              </CardTitle>
              <p className="text-xs text-muted-foreground">Your file is live on the public CDN.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {succeeded[0].preview && (
                <img src={succeeded[0].preview} alt="" className="rounded-xl max-h-52 object-contain bg-black/20 w-full" />
              )}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">File</div>
                <div className="text-sm font-medium">{succeeded[0].file.name}</div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">Canonical Public URL</div>
                <code className="block w-full text-xs px-3 py-2.5 bg-black/30 rounded-lg font-mono break-all border border-white/[0.08] text-emerald-300">
                  {succeeded[0].url}
                </code>
                <div className="flex gap-2 flex-wrap">
                  <CopyButton
                    text={succeeded[0].url!}
                    label="Copy URL"
                    size="default"
                    variant="secondary"
                    className="flex-1"
                    onCopy={() => toast({ title: "Copied", description: "Public URL copied to clipboard." })}
                  />
                  <Button size="default" variant="outline" className="flex-1" asChild>
                    <a href={succeeded[0].url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5 mr-1.5" aria-hidden /> Open
                    </a>
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap pt-1">
                <Button size="sm" variant="ghost" onClick={resetBatch}>
                  <Plus className="size-3.5 mr-1" aria-hidden /> Upload Another
                </Button>
                <Button size="sm" variant="ghost" onClick={() => router.push("/files")}>
                  View All Files
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Batch summary card — Tier 1 only when failures need attention */}
        {!singleMode && allDone && (
          <Card tier={failed.length > 0 ? "actionable" : "informational"} className="animate-page-enter">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {failed.length > 0 ? (
                  <CircleX className="size-4 text-red-400" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-400 animate-success-pop" aria-hidden />
                )}
                {succeeded.length} succeeded, {failed.length} failed
              </CardTitle>
              {failed.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Failed files are safe on your device — retry them individually.
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {succeeded.length > 0 && (
                <Button size="sm" variant="secondary" onClick={copyAll}>
                  Copy All URLs
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={resetBatch}>
                <Plus className="size-3.5 mr-1" aria-hidden /> Upload Another Batch
              </Button>
              <Button size="sm" onClick={() => router.push("/files")}>View All Files</Button>
            </CardContent>
          </Card>
        )}

        {!allDone && (
          <div className="flex gap-2">
            <Button onClick={startUpload} disabled={items.length === 0 || !channelId || uploading}>
              {uploading && <Loader2 className="size-4 animate-spin mr-2" aria-hidden />}
              {uploading ? `Uploading… ${succeeded.length}/${items.length}` : items.length > 1 ? `Upload ${items.length} files` : "Upload"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadStatusBadge({ status }: { status: ItemStatus }) {
  // 5-color model: pending = waiting (amber), uploading = transit (sky),
  // success = completed (green), failed = exception (red).
  const tone = status === "success" ? "completed" : status === "failed" ? "exception" : status === "uploading" ? "transit" : "waiting";
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
}

function StepDot({ n, label, done }: { n: number; label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-1.5 shrink-0" aria-current={done ? undefined : "step"}>
      <span
        className={cn(
          "size-5 rounded-full text-[10px] font-semibold flex items-center justify-center duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color,color]",
          done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
        )}
        aria-hidden
      >
        {done ? <CheckCircle2 className="size-3" aria-hidden /> : n}
      </span>
      <span className={done ? "text-foreground font-medium" : undefined}>{label}</span>
    </li>
  );
}
