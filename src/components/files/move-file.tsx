"use client";

import { useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type FolderRow = { id: number; name: string; parentId: number | null };

export function MoveFile({ fileId, currentFolderId }: { fileId: number; currentFolderId: number | null }) {
  const [folderId, setFolderId] = useState(currentFolderId == null ? "root" : String(currentFolderId));
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data } = useQuery<FolderRow[]>({
    queryKey: ["folders", "all"],
    queryFn: async () => {
      const r = await fetch("/api/folders?all=true");
      if (!r.ok) throw new Error("Failed to load folders");
      const j = await r.json();
      return j.folders;
    },
  });

  const move = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folderId === "root" ? null : Number(folderId) }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "Move failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["file-detail", fileId] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast({ title: "File moved", description: folderId === "root" ? "Moved to root." : "Folder updated." });
    },
    onError: (e: Error) => toast({ title: "Move failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FolderOpen className="size-4 text-primary" /> Folder
      </div>
      <div className="flex gap-2">
        <Select value={folderId} onValueChange={setFolderId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Choose folder" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="root"><span className="flex items-center gap-2"><Folder className="size-3.5" /> Root</span></SelectItem>
            {data?.map((folder) => (
              <SelectItem key={folder.id} value={String(folder.id)}>
                {folder.parentId ? "↳ " : ""}{folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => move.mutate()} disabled={move.isPending || folderId === (currentFolderId == null ? "root" : String(currentFolderId))}>
          {move.isPending ? "Moving…" : "Move"}
        </Button>
      </div>
    </div>
  );
}
