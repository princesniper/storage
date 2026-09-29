"use client";
import { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, ExternalLink, Search, ImageIcon, CalendarIcon, X, LayoutGrid, List, Film, Upload, CloudOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { FileStatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FileGridSkeleton } from "@/components/ui/skeletons";
import { CopyButton } from "@/components/ui/copy-button";
import { formatBytes, formatDate, isVideoMime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MediaGrid } from "@/components/media/media-grid";
import { MediaLightbox } from "@/components/media/media-lightbox";
import type { MediaFile } from "@/components/media/media-card";

interface FileRow {
  id: number;
  publicId: string;
  sequenceNumber: number | null;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  publicUrl: string;
  width: number | null;
  height: number | null;
  thumbnailPublicId: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  storageChannel: { id: number; name: string };
}

interface ChannelRow {
  id: number;
  name: string;
}

type ViewMode = "grid" | "list";

const SORT_OPTIONS = [
  { value: "created:desc", label: "Newest first" },
  { value: "created:asc", label: "Oldest first" },
  { value: "name:asc", label: "Name A → Z" },
  { value: "name:desc", label: "Name Z → A" },
  { value: "size:desc", label: "Largest first" },
  { value: "size:asc", label: "Smallest first" },
];

const MIME_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WEBP" },
  { value: "image/gif", label: "GIF" },
  { value: "video/mp4", label: "MP4" },
  { value: "video/webm", label: "WEBM" },
  { value: "video/quicktime", label: "MOV" },
];

function paramsToState(sp: URLSearchParams) {
  const sort = sp.get("sort") ?? "created";
  const order = sp.get("order") ?? (sort === "name" ? "asc" : "desc");
  return {
    search: sp.get("search") ?? "",
    channelId: sp.get("channelId") ?? "all",
    status: sp.get("status") ?? "active",
    sort,
    order,
    mimeType: sp.get("mimeType") ?? "all",
    minSize: sp.get("minSize") ?? "",
    maxSize: sp.get("maxSize") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    page: Number(sp.get("page") ?? 1) || 1,
  };
}

export default function FilesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = useMemo(() => paramsToState(new URLSearchParams(searchParams.toString())), [searchParams]);

  const [search, setSearch] = useState(initial.search);
  const [channelId, setChannelId] = useState(initial.channelId);
  const [status, setStatus] = useState(initial.status);
  const [sortValue, setSortValue] = useState(`${initial.sort}:${initial.order}`);
  const [mimeType, setMimeType] = useState(initial.mimeType);
  const [minSizeKb, setMinSizeKb] = useState(initial.minSize);
  const [maxSizeKb, setMaxSizeKb] = useState(initial.maxSize);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [page, setPage] = useState(initial.page);
  // Hydration-safe persisted view (server renders "grid", stored value
  // applies after hydration — no server/client HTML mismatch).
  const [viewRaw, setViewRaw] = useLocalStorageState("files-view", "grid");
  const view: ViewMode = viewRaw === "list" ? "list" : "grid";
  const setViewMode = (v: ViewMode) => setViewRaw(v);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileRow | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const pageSize = 24;
  const { toast } = useToast();
  const qc = useQueryClient();

  const syncUrl = useCallback(
    (patch: Record<string, string>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v || v === "all" && (k === "channelId" || k === "mimeType")) {
          if (k === "status" && v) { sp.set(k, v); continue; }
          sp.delete(k);
        } else {
          sp.set(k, v);
        }
      }
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const [sort, order] = sortValue.split(":");

  const queryKey = useMemo(
    () => ["files", { search, channelId, status, page, sort, order, mimeType, minSizeKb, maxSizeKb, from, to }],
    [search, channelId, status, page, sort, order, mimeType, minSizeKb, maxSizeKb, from, to]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    files: FileRow[];
    total: number;
    channels: ChannelRow[];
  }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (channelId !== "all") params.set("channelId", channelId);
      if (status !== "all") params.set("status", status);
      params.set("sort", sort);
      params.set("order", order);
      if (mimeType !== "all") params.set("mimeType", mimeType);
      if (minSizeKb) params.set("minSize", String(Math.round(Number(minSizeKb) * 1024)));
      if (maxSizeKb) params.set("maxSize", String(Math.round(Number(maxSizeKb) * 1024)));
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(page));
      params.set("limit", String(pageSize));
      const r = await fetch(`/api/files?${params}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to load files");
      }
      const json = await r.json();
      return { files: json.files, total: json.total, channels: json.channels };
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Delete failed");
      }
    },
    onSuccess: () => {
      toast({ title: "Media deleted", description: "Public URL stopped working." });
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e: Error) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await fetch("/api/files/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Bulk delete failed");
      }
      return r.json() as Promise<{ deleted: number[]; failed: { id: number; error: string }[] }>;
    },
    onSuccess: (res) => {
      setSelected(new Set());
      setBulkConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["files"] });
      if (res.failed.length > 0) {
        toast({
          title: `${res.deleted.length} deleted, ${res.failed.length} couldn't be deleted`,
          description: "Retry the failed files individually.",
          variant: "destructive",
        });
      } else {
        toast({ title: `${res.deleted.length} media files deleted`, description: "Public URLs stopped working." });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Bulk delete failed", description: e.message, variant: "destructive" });
    },
  });

  const copyUrl = useCallback(
    (url: string) => {
      toast({ title: "Copied", description: "Public URL copied to clipboard." });
    },
    [toast]
  );

  const files = data?.files ?? [];
  const siblingIds = useMemo(() => files.map((f) => f.id), [files]);
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.id));

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.id)));
  };

  const openDetail = (id: number) => {
    setDetailId(id);
    setDetailOpen(true);
  };

  const resetPage = () => setPage(1);

  const hasActiveFilters = mimeType !== "all" || minSizeKb || maxSizeKb || from || to;

  const clearExtraFilters = () => {
    setMimeType("all");
    setMinSizeKb("");
    setMaxSizeKb("");
    setFrom("");
    setTo("");
    resetPage();
    syncUrl({ mimeType: "", minSize: "", maxSize: "", from: "", to: "", page: "1" });
  };

  const confirmSingleDelete = (f: FileRow) => {
    setPendingDelete(f);
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            Media Library
            {data?.total !== undefined && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 tabular-nums">
                {data.total.toLocaleString()} files
              </span>
            )}
          </span>
        }
        description="Browse, inspect, and manage your media assets."
        actions={
          <>
            <div className="flex rounded-lg border border-border p-0.5 gap-0.5" role="group" aria-label="View mode">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={view === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-2.5"
                    onClick={() => setViewMode("grid")}
                    aria-label="Grid view"
                    aria-pressed={view === "grid"}
                  >
                    <LayoutGrid className="size-3.5" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Grid view</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={view === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-2.5"
                    onClick={() => setViewMode("list")}
                    aria-label="List view"
                    aria-pressed={view === "list"}
                  >
                    <List className="size-3.5" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>List view</TooltipContent>
              </Tooltip>
            </div>
            {files.length > 0 && (
              <label className="flex items-center gap-2 text-sm shrink-0 cursor-pointer">
                <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all files on this page" />
                <span className="text-muted-foreground hidden sm:inline text-xs">Select all</span>
              </label>
            )}
            <Button size="sm" asChild>
              <a href="/upload"><Upload className="size-3.5 mr-1" aria-hidden /> Upload</a>
            </Button>
          </>
        }
      />

      {/* ─── Filters ─── */}
      <div className="flex flex-col gap-3">
        {/* Search + dropdowns */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Search by filename, sequence or public ID…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
                syncUrl({ search: e.target.value, page: "1" });
              }}
              className="pl-9 bg-white/[0.03] border-white/[0.08] focus:border-emerald-500/40"
              aria-label="Search files"
            />
          </div>
          <Select
            value={channelId}
            onValueChange={(v) => {
              setChannelId(v);
              resetPage();
              syncUrl({ channelId: v === "all" ? "" : v, page: "1" });
            }}
          >
            <SelectTrigger className="w-full md:w-48" aria-label="Storage channel filter">
              <SelectValue placeholder="Storage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Storage</SelectItem>
              {data?.channels?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              resetPage();
              syncUrl({ status: v, page: "1" });
            }}
          >
            <SelectTrigger className="w-full md:w-36" aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sortValue}
            onValueChange={(v) => {
              setSortValue(v);
              resetPage();
              const [s, o] = v.split(":");
              syncUrl({ sort: s, order: o, page: "1" });
            }}
          >
            <SelectTrigger className="w-full md:w-44" aria-label="Sort files">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* MIME type pill filters */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { value: "all", label: "All" },
            { value: "image/jpeg", label: "JPEG" },
            { value: "image/png", label: "PNG" },
            { value: "image/webp", label: "WEBP" },
            { value: "image/gif", label: "GIF" },
            { value: "video/mp4", label: "MP4" },
            { value: "video/webm", label: "WEBM" },
            { value: "video/quicktime", label: "MOV" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setMimeType(opt.value);
                resetPage();
                syncUrl({ mimeType: opt.value === "all" ? "" : opt.value, page: "1" });
              }}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150",
                mimeType === opt.value
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
          <div className="flex gap-2 ml-auto">
            <Input
              type="number" min={0} placeholder="Min KB" value={minSizeKb}
              onChange={(e) => { setMinSizeKb(e.target.value); resetPage(); syncUrl({ minSize: e.target.value, page: "1" }); }}
              className="w-24 h-9 md:h-7 text-xs bg-white/[0.03] border-white/[0.08]" aria-label="Minimum size in KB"
            />
            <Input
              type="number" min={0} placeholder="Max KB" value={maxSizeKb}
              onChange={(e) => { setMaxSizeKb(e.target.value); resetPage(); syncUrl({ maxSize: e.target.value, page: "1" }); }}
              className="w-24 h-9 md:h-7 text-xs bg-white/[0.03] border-white/[0.08]" aria-label="Maximum size in KB"
            />
            <DatePicker label="From" value={from} onChange={(v) => { setFrom(v); resetPage(); syncUrl({ from: v, page: "1" }); }} />
            <DatePicker label="To" value={to} onChange={(v) => { setTo(v); resetPage(); syncUrl({ to: v, page: "1" }); }} />
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearExtraFilters} className="shrink-0 h-7 px-2 text-xs">
                <X className="size-3 mr-1" aria-hidden /> Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <FileGridSkeleton />
      ) : isError ? (
        <EmptyState
          icon={CloudOff}
          title="Couldn't load media"
          description="The library didn't load. Check your connection and try again — your files are safe."
          action={
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          }
        />
      ) : files.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={search || hasActiveFilters ? "No files match your filters" : "No files yet"}
          description={search || hasActiveFilters ? "Try adjusting your search or clearing filters." : "Upload your first image or video to get started."}
          action={
            search || hasActiveFilters ? (
              <Button size="sm" variant="outline" onClick={() => { setSearch(""); clearExtraFilters(); syncUrl({ search: "" }); }}>
                Clear search & filters
              </Button>
            ) : (
              <Button size="sm" asChild>
                <a href="/upload"><Upload className="size-3.5 mr-1" aria-hidden /> Upload files</a>
              </Button>
            )
          }
        />
      ) : view === "grid" ? (
        <MediaGrid
          files={files as unknown as MediaFile[]}
          selected={selected}
          onSelect={(id) => toggleSelect(id)}
          onOpen={(id) => openDetail(id)}
          onDelete={(f) => confirmSingleDelete(f as unknown as FileRow)}
        />
      ) : (
        <div className="rounded-xl border border-white/[0.07] overflow-hidden bg-[#111113]">
          <ul className="divide-y divide-white/[0.05]">
            {files.map((f, i) => (
              <FileListRow
                key={f.id}
                file={f}
                index={i}
                selected={selected.has(f.id)}
                onToggleSelect={() => toggleSelect(f.id)}
                onOpen={() => openDetail(f.id)}
                onDelete={() => confirmSingleDelete(f)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > pageSize && (
        <div className="flex flex-wrap gap-2 items-center justify-between text-sm">
          <span className="text-muted-foreground tabular-nums">
            {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => { setPage(page - 1); syncUrl({ page: String(page - 1) }); }}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * pageSize >= data.total}
              onClick={() => { setPage(page + 1); syncUrl({ page: String(page + 1) }); }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ─── Floating batch action bar ─── */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full shadow-2xl shadow-black/60 px-5 py-3 animate-page-enter border border-white/[0.12] glass-panel">
          <span className="size-6 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-[11px] font-bold text-emerald-400 shrink-0">
            {selected.size}
          </span>
          <span className="text-sm font-medium whitespace-nowrap text-foreground">
            {selected.size} selected
          </span>
          <div className="w-px h-4 bg-white/[0.08]" aria-hidden />
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setBulkConfirmOpen(true)}
            disabled={bulkDeleteMutation.isPending}
            className="rounded-full h-9 px-4 text-xs"
          >
            <Trash2 className="size-3 mr-1" aria-hidden /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="rounded-full h-9 px-4 text-xs text-muted-foreground">
            <X className="size-3 mr-1" aria-hidden /> Clear
          </Button>
        </div>
      )}

      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} media files?</AlertDialogTitle>
            <AlertDialogDescription>
              Public URLs stop working immediately. Files are soft-deleted and recoverable from the database;
              sequence numbers stay consumed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteMutation.mutate(Array.from(selected))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteMutation.isPending ? "Deleting…" : `Delete ${selected.size} files`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single-file delete confirmation (replaces window.confirm) */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete media?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  <span className="font-medium text-foreground break-words">{pendingDelete.originalName}</span>
                  {" "}will stop serving publicly. Soft-deleted and recoverable; its sequence number stays consumed.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete media
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cinema lightbox */}
      <MediaLightbox
        file={detailId ? (files.find((f) => f.id === detailId) as unknown as MediaFile ?? null) : null}
        siblings={siblingIds}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onNavigate={(id) => setDetailId(id)}
        onDeleted={() => qc.invalidateQueries({ queryKey: ["files"] })}
      />

    </div>
  );
}

function DatePicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const selected = value ? new Date(value + "T00:00:00") : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-normal">
          <CalendarIcon className="size-3.5" aria-hidden />
          {value || label}
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label} date filter`}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onChange("");
                }
              }}
            >
              <X className="size-3" aria-hidden />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => d && onChange(d.toISOString().slice(0, 10))}
        />
      </PopoverContent>
    </Popover>
  );
}

function Thumb({ file, className }: { file: FileRow; className?: string }) {
  if (isVideoMime(file.mimeType)) {
    if (file.thumbnailUrl) {
      return (
        <img
          src={file.thumbnailUrl}
          alt=""
          loading="lazy"
          className={className ?? "size-full object-cover"}
        />
      );
    }
    return (
      <span className="size-full flex items-center justify-center bg-muted/40">
        <Film className="size-6 text-muted-foreground" aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={file.publicUrl}
      alt=""
      loading="lazy"
      className={className ?? "size-full object-cover"}
    />
  );
}

interface CardProps {
  file: FileRow;
  index: number;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

function FileGridCard({ file, index, selected, onToggleSelect, onOpen, onCopy, onDelete }: CardProps) {
  const video = isVideoMime(file.mimeType);
  return (
    <Card
      className={cn(
        "overflow-hidden group cursor-pointer card-interactive animate-page-enter",
        selected && "ring-2 ring-primary"
      )}
      style={{ "--enter-delay": `${Math.min(index, 11) * 25}ms` } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${file.originalName} — open details`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="aspect-square bg-muted/30 relative overflow-hidden">
        <span className="block size-full">
          <Thumb file={file} />
        </span>
        {file.status !== "active" && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <FileStatusBadge status={file.status} />
          </div>
        )}
        {/* Selection checkbox */}
        <span
          className={cn(
            "absolute top-2 left-2 z-10 duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-opacity",
            selected ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select ${file.originalName}`}
            className="size-5 bg-background/90 shadow-sm backdrop-blur"
          />
        </span>
        {/* Hover quick actions */}
        <span
          className="absolute inset-x-2 bottom-2 z-10 hidden md:flex items-center justify-center gap-1 rounded-lg bg-background/85 backdrop-blur px-1.5 py-1.5 shadow-lg opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <CopyButton text={file.publicUrl} label="Copy" className="h-7 flex-1" />
          <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
            <a href={file.publicUrl} target="_blank" rel="noreferrer" aria-label={`Open ${file.originalName} in new tab`}>
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={onDelete} aria-label={`Delete ${file.originalName}`}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </span>
        {video && (
          <span className="absolute bottom-2 right-2 rounded bg-background/85 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold pointer-events-none md:group-hover:opacity-0 transition-opacity">
            VIDEO
          </span>
        )}
      </div>
      <div className="p-3 space-y-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="text-xs font-medium truncate" title={file.originalName}>{file.originalName}</div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatBytes(Number(file.size))}{file.width && file.height ? ` · ${file.width}×${file.height}` : ""}</span>
          <span className="truncate ml-2 max-w-[45%]">{file.storageChannel?.name}</span>
        </div>
        {/* Touch fallback actions (hover overlay is desktop-only) */}
        <div className="flex md:hidden items-center gap-1 pt-0.5">
          <CopyButton text={file.publicUrl} label="Copy" className="h-7 flex-1" />
          <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
            <a href={file.publicUrl} target="_blank" rel="noreferrer" aria-label="Open in new tab">
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={onDelete} aria-label="Delete file">
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FileListRow({ file, selected, onToggleSelect, onOpen, onDelete }: Omit<CardProps, "index" | "onCopy"> & { index: number }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 cursor-pointer duration-[var(--duration-fast)] ease-[cubic-bezier(0.16,1,0.3,1)] transition-[background-color] hover:bg-white/[0.03]",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
        selected && "bg-primary/5"
      )}
      role="button"
      tabIndex={0}
      aria-label={`${file.originalName} — open details`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Select ${file.originalName}`} />
      </span>
      <span className="size-12 rounded-lg overflow-hidden bg-muted/40 shrink-0">
        <Thumb file={file} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate" title={file.originalName}>{file.originalName}</span>
        <span className="block text-xs text-muted-foreground truncate">
          {file.storageChannel?.name} · {formatDate(file.createdAt)}
          {file.width && file.height ? ` · ${file.width}×${file.height}` : ""}
        </span>
      </span>
      <span className="hidden md:block text-xs text-muted-foreground tabular-nums shrink-0 w-20 text-right">
        {formatBytes(Number(file.size))}
      </span>
      <span className="hidden sm:block shrink-0">
        <FileStatusBadge status={file.status} />
      </span>
      <span className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <CopyButton text={file.publicUrl} iconOnly label="Copy URL" className="size-9" />
        <Button variant="ghost" size="icon" className="size-9" asChild>
          <a href={file.publicUrl} target="_blank" rel="noreferrer" aria-label="Open in new tab">
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
        <Button variant="ghost" size="icon" className="size-9 text-destructive hover:text-destructive" onClick={onDelete} aria-label="Delete file">
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </span>
    </li>
  );
}
