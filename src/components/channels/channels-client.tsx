"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, FolderTree, Trash2, Zap, Pencil, Loader2, AlertTriangle, Files, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ChannelCardsSkeleton } from "@/components/ui/skeletons";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChannelRow {
  id: number;
  name: string;
  telegramChannelId: string;
  purpose: string | null;
  status: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestLatencyMs?: number | null;
  _count?: { files: number };
}

export default function ChannelsClient() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ChannelRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ channels: ChannelRow[]; telegramStatus: string }>({
    queryKey: ["channels"],
    queryFn: async () => {
      const r = await fetch("/api/channels");
      if (!r.ok) throw new Error("Failed to load channels");
      return r.json();
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/channels/${id}/test`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Test failed");
      return json;
    },
    onSuccess: (data) => {
      toast({
        title: data.ok ? "Connection OK" : "Connection failed",
        description: data.ok ? `Latency ${data.latencyMs}ms` : data.error,
        variant: data.ok ? "default" : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: Error) => {
      toast({ title: "Connection test failed", description: e.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await fetch(`/api/channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status === "active" ? "inactive" : "active" }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Toggle failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast({ title: "Channel updated" });
    },
    onError: (e: Error) => toast({ title: "Couldn't save channel", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/channels/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Delete failed");
      }
    },
    onSuccess: () => {
      toast({ title: "Channel registration removed", description: "Telegram content was NOT touched." });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't remove channel", description: e.message, variant: "destructive" }),
  });

  const telegramConnected = data?.telegramStatus === "connected";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage Channels"
        description="Telegram channels used as zero-cost storage nodes."
        actions={
          <Button size="sm" onClick={() => { setShowAdd(true); setEditing(null); }} disabled={!telegramConnected}>
            <Plus className="size-3.5 mr-1" aria-hidden /> Add Channel
          </Button>
        }
      />

      {!telegramConnected && !isLoading && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>Telegram is not connected</AlertTitle>
          <AlertDescription>
            Connect a Telegram account in{" "}
            <a href="/settings" className="underline underline-offset-2 font-medium">Settings</a>{" "}
            before adding channels.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <ChannelCardsSkeleton />
      ) : isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load channels"
          description="Something went wrong while fetching your storage channels."
          action={<Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : !data?.channels || data.channels.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No storage channels yet"
          description="Register a private Telegram channel to start storing files. Create the channel in your Telegram app first."
          action={
            <Button size="sm" onClick={() => { setShowAdd(true); setEditing(null); }} disabled={!telegramConnected}>
              <Plus className="size-3.5 mr-1" aria-hidden /> Add your first channel
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.channels.map((c, i) => (
            <ChannelCard
              key={c.id}
              channel={c}
              index={i}
              testing={testMutation.isPending}
              onTest={() => testMutation.mutate(c.id)}
              onEdit={() => { setEditing(c); setShowAdd(true); }}
              onToggle={() => toggleMutation.mutate({ id: c.id, status: c.status })}
              onDelete={() => deleteMutation.mutate(c.id)}
            />
          ))}
        </div>
      )}

      <AddChannelDialog
        open={showAdd}
        onOpenChange={(o) => { setShowAdd(o); if (!o) setEditing(null); }}
        editing={editing}
      />
    </div>
  );
}

function ChannelCard({
  channel: c,
  index,
  testing,
  onTest,
  onEdit,
  onToggle,
  onDelete,
}: {
  channel: ChannelRow;
  index: number;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const active = c.status === "active";
  const needsAttention = c.lastTestOk === false;
  return (
    <Card
      tier={needsAttention ? "actionable" : "informational"}
      className={cn(
        "card-interactive animate-page-enter overflow-hidden",
        !active && "opacity-70"
      )}
      style={{ "--enter-delay": `${Math.min(index, 7) * 40}ms` } as React.CSSProperties}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className={cn(
              "size-10 rounded-xl flex items-center justify-center shrink-0 transition-colors border",
              active
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-white/[0.03] border-white/[0.06] text-muted-foreground"
            )}>
              <FolderTree className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold truncate">{c.name}</CardTitle>
                <StatusBadge tone={active ? "completed" : "neutral"}>{c.status}</StatusBadge>
                {needsAttention && <StatusBadge tone="waiting">test failed</StatusBadge>}
              </div>
              <CardDescription className="mt-0.5 truncate text-xs">{c.purpose ?? "No purpose set"}</CardDescription>
            </div>
          </div>
          <Switch
            checked={active}
            onCheckedChange={onToggle}
            aria-label={`${active ? "Deactivate" : "Activate"} channel ${c.name}`}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <dl className="text-xs space-y-2">
          {/* Channel ID with copy button */}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground shrink-0">Channel ID</dt>
            <dd className="flex items-center gap-1.5 min-w-0">
              <code className="font-mono bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded text-[11px] truncate max-w-[140px]">
                {c.telegramChannelId}
              </code>
              <CopyButton text={c.telegramChannelId} iconOnly label="Copy channel ID" size="icon" className="size-6 shrink-0" />
            </dd>
          </div>

          {/* Stored files */}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground flex items-center gap-1">
              <Files className="size-3" aria-hidden /> Stored files
            </dt>
            <dd className="font-medium tabular-nums">{c._count?.files ?? 0}</dd>
          </div>

          {/* Last test / latency */}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Last test</dt>
            <dd>
              {!c.lastTestedAt ? (
                <span className="text-muted-foreground">Never tested</span>
              ) : c.lastTestOk ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]" aria-hidden />
                  <span className="text-emerald-400 font-medium font-mono text-[11px]">
                    OK{c.lastTestLatencyMs ? ` · ${c.lastTestLatencyMs}ms` : ""}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-red-400" aria-hidden />
                  <span className="text-destructive font-medium text-[11px]" title={c.lastTestError ?? "unknown"}>
                    Failed
                  </span>
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="flex gap-2 pt-1 border-t border-white/[0.05]">
          <Button size="sm" variant="outline" onClick={onTest} disabled={testing} className="flex-1">
            {testing ? <Loader2 className="size-3.5 mr-1 animate-spin" aria-hidden /> : <Zap className="size-3.5 mr-1" aria-hidden />}
            Test
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1" aria-hidden /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this channel registration?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the channel from the storage dashboard only. Existing Telegram content and file mappings are not affected.
                  Files already uploaded via this channel remain accessible via their public URLs.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onDelete}
                >
                  Remove registration
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function AddChannelDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: ChannelRow | null }) {
  // NOTE: Radix unmounts DialogContent on close, so these initializers re-run
  // on every open — fields always reflect the current add/edit target.
  // (The previous useState-initializer-as-effect pattern kept stale values.)
  const [name, setName] = useState(editing?.name ?? "");
  const [channelId, setChannelId] = useState(editing?.telegramChannelId ?? "");
  const [purpose, setPurpose] = useState(editing?.purpose ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const submit = async () => {
    if (!name || !channelId) {
      toast({ title: "Name and Channel ID are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/channels/${editing.id}` : "/api/channels";
      const method = editing ? "PATCH" : "POST";
      const body = editing
        ? { name, purpose }
        : { name, telegramChannelId: channelId, purpose };
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) {
        toast({ title: editing ? "Couldn't save channel" : "Couldn't add channel", description: json.error ?? "Check the details and retry.", variant: "destructive" });
        return;
      }
      toast({ title: editing ? "Channel updated" : "Channel added" });
      qc.invalidateQueries({ queryKey: ["channels"] });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Channel" : "Add Storage Channel"}</DialogTitle>
          <DialogDescription>
            Register an existing private Telegram channel. Create it in your Telegram app first,
            then paste its channel ID (looks like -1001234567890).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ch-name">Display Name</Label>
            <Input id="ch-name" placeholder="🌿 GrowPlants Storage" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ch-id">Telegram Channel ID</Label>
            <Input
              id="ch-id"
              placeholder="-1001234567890"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={!!editing}
              className="font-mono"
            />
            {editing && <p className="text-xs text-muted-foreground">Channel ID cannot be changed after creation.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ch-purpose">Purpose</Label>
            <Textarea
              id="ch-purpose"
              placeholder="e.g. Website product images"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden />}
            {editing ? "Save" : "Add Channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
