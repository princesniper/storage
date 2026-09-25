"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, FolderPlus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { id: number; name: string; _count?: { children: number; files: number } };

export default function FoldersClient() {
  const [parentId, setParentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery<Item[]>({
    queryKey: ["folders", parentId],
    queryFn: async () => {
      const q = parentId == null ? "" : `?parentId=${parentId}`;
      const r = await fetch(`/api/folders${q}`);
      if (!r.ok) throw new Error("Failed to load folders");
      return r.json();
    },
  });

  async function createFolder() {
    if (!name.trim()) return;
    const r = await fetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), parentId }) });
    if (!r.ok) return alert((await r.json()).error || "Could not create folder");
    setName(""); qc.invalidateQueries({ queryKey: ["folders"] });
  }

  async function rename(id: number) {
    if (!name.trim()) return;
    await fetch(`/api/folders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    setEditing(null); setName(""); qc.invalidateQueries({ queryKey: ["folders"] });
  }

  async function remove(id: number) {
    if (!confirm("Delete this folder? Files will be moved to the root.")) return;
    const r = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (!r.ok) return alert("Could not delete folder");
    qc.invalidateQueries({ queryKey: ["folders"] });
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading folders…</div>;

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Folders</h1>
        <p className="text-sm text-muted-foreground">Organize your Telegram media library.</p>
      </div>
      <div className="flex gap-2 max-w-xl">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="New folder name" onKeyDown={e => e.key === "Enter" && createFolder()} />
        <Button onClick={createFolder}><FolderPlus className="mr-2 h-4 w-4" />Create</Button>
      </div>
      <div className="flex items-center gap-1 text-sm">
        <Button variant="ghost" size="sm" onClick={() => setParentId(null)}>Root</Button>
        {parentId != null && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="grid gap-2">
        {data.length === 0 && <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">No folders yet.</div>}
        {data.map(folder => (
          <div key={folder.id} className="flex items-center gap-3 rounded-lg border p-3">
            <Folder className="h-5 w-5 text-muted-foreground" />
            {editing === folder.id ? (
              <Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && rename(folder.id)} className="max-w-sm" />
            ) : (
              <button className="flex-1 text-left font-medium" onDoubleClick={() => setParentId(folder.id)}>{folder.name}</button>
            )}
            <span className="text-xs text-muted-foreground">{folder._count?.files ?? 0} files</span>
            {editing === folder.id ? <Button size="sm" onClick={() => rename(folder.id)}>Save</Button> : <Button variant="ghost" size="icon" onClick={() => { setEditing(folder.id); setName(folder.name); }}><Pencil className="h-4 w-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={() => remove(folder.id)}><Trash2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setParentId(folder.id)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
