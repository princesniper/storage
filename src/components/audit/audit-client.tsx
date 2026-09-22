"use client";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CalendarIcon, X, Download, ArrowUpDown, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import FileDetailModal from "@/components/files/file-detail-modal";
import { PageHeader } from "@/components/ui/page-header";
import { AuditStatusBadge } from "@/components/ui/status-badge";
import { TableSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollText } from "lucide-react";
import { formatDateTime } from "@/lib/format";

export interface AuditRow {
  id: number;
  operation: string;
  status: string;
  errorMessage: string | null;
  ip: string | null;
  createdAt: string;
  adminEmail: string | null;
  file: { id: number; publicId: string; originalName: string } | null;
}

const OPERATIONS = [
  "all",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "UPLOAD",
  "DELETE",
  "CHANNEL_ADD",
  "CHANNEL_DELETE",
  "CHANNEL_TEST",
  "CHANNEL_UPDATE",
  "TELEGRAM_CONNECT",
  "TELEGRAM_DISCONNECT",
  "TELEGRAM_ERROR",
];

const STATUSES = ["all", "SUCCESS", "FAILED", "PARTIAL"];

export default function AuditClient({
  initialLogs,
  initialTotal,
}: {
  initialLogs: AuditRow[];
  initialTotal: number;
}) {
  const { toast } = useToast();
  const [operation, setOperation] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [timeAsc, setTimeAsc] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pageSize = 50;

  const isDefaultFilter =
    operation === "all" && status === "all" && !from && !to && !search && page === 1;

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ logs: AuditRow[]; total: number }>({
    queryKey: ["audit", { operation, status, from, to, search, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (operation !== "all") params.set("operation", operation);
      if (status !== "all") params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(pageSize));
      const r = await fetch(`/api/audit?${params}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to load audit logs");
      }
      return r.json();
    },
    initialData: isDefaultFilter ? { logs: initialLogs, total: initialTotal } : undefined,
  });

  const rows = useMemo(() => {
    const list = data?.logs ?? [];
    return timeAsc ? [...list].reverse() : list;
  }, [data, timeAsc]);

  const total = data?.total ?? 0;

  const resetPage = () => setPage(1);

  const clearFilters = () => {
    setOperation("all");
    setStatus("all");
    setFrom("");
    setTo("");
    setSearch("");
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (operation !== "all") params.set("operation", operation);
      if (status !== "all") params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      params.set("limit", "100");
      const all: AuditRow[] = [];
      let p = 1;
      for (;;) {
        params.set("page", String(p));
        const r = await fetch(`/api/audit?${params}`);
        if (!r.ok) throw new Error("Export fetch failed");
        const json = await r.json();
        all.push(...(json.logs as AuditRow[]));
        if (all.length >= json.total || all.length >= 1000 || json.logs.length === 0) break;
        p += 1;
      }
      const header = "id,timestamp,operation,status,fileId,adminEmail,ip,errorMessage";
      const lines = all.map((l) =>
        [
          l.id,
          new Date(l.createdAt).toISOString(),
          l.operation,
          l.status,
          l.file?.id ?? "",
          l.adminEmail ?? "",
          l.ip ?? "",
          csvEscape(l.errorMessage ?? ""),
        ].join(",")
      );
      const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported", description: `${all.length} rows downloaded as CSV.` });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description={`${total} entr${total === 1 ? "y" : "ies"} · every important operation with status and error details.`}
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting}>
            <Download className="size-3.5 mr-1" aria-hidden /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search error message, operation, IP…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            className="pl-9"
          />
        </div>
        <Select value={operation} onValueChange={(v) => { setOperation(v); resetPage(); }}>
          <SelectTrigger className="w-full md:w-48" aria-label="Operation">
            <SelectValue placeholder="Operation" />
          </SelectTrigger>
          <SelectContent>
            {OPERATIONS.map((o) => (
              <SelectItem key={o} value={o}>{o === "all" ? "All operations" : o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); resetPage(); }}>
          <SelectTrigger className="w-full md:w-36" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <DatePicker label="From" value={from} onChange={(v) => { setFrom(v); resetPage(); }} />
          <DatePicker label="To" value={to} onChange={(v) => { setTo(v); resetPage(); }} />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-x-auto">
        {isLoading && !data ? (
          <div className="p-4">
            <TableSkeleton rows={8} cols={5} />
          </div>
        ) : isError && rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ScrollText}
              title="Couldn't load audit entries"
              description="The log didn't load. Check your connection and try again."
              action={
                <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching ? "Retrying…" : "Retry"}
                </Button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ScrollText}
              title="No audit entries match your filters"
              description="Try adjusting the operation, status, date range or search — or start fresh."
              action={
                !isDefaultFilter ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() => setTimeAsc((v) => !v)}
                >
                  Timestamp <ArrowUpDown className="size-3" aria-hidden />
                </button>
              </TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>IP</TableHead>
              <TableHead className="max-w-56">Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id} className="animate-page-enter">
                <TableCell className="text-xs whitespace-nowrap tabular-nums">
                  {formatDateTime(l.createdAt)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-[11px]">{l.operation}</Badge>
                </TableCell>
                <TableCell>
                  <AuditStatusBadge status={l.status} />
                </TableCell>
                  <TableCell className="text-xs">
                    {l.file ? (
                      <button
                        className="text-primary hover:underline font-mono"
                        title={l.file.originalName}
                        onClick={() => {
                          setDetailId(l.file!.id);
                          setDetailOpen(true);
                        }}
                      >
                        #{l.file.id}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-40 truncate">{l.adminEmail ?? "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{l.ip ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-56">
                    {l.errorMessage ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate text-destructive cursor-help">
                              {l.errorMessage}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-80 break-words">
                            {l.errorMessage}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex flex-wrap gap-2 items-center justify-between text-sm">
          <span className="text-muted-foreground tabular-nums">
            {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * pageSize >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <FileDetailModal
        fileId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
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
          <CalendarIcon className="size-3.5" />
          {value || label}
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label}`}
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
              <X className="size-3" />
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

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
