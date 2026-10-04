import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY", detail: "Select between 1 and 100 folders." }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  const all = await db.folder.findMany({ select: { id: true, parentId: true } });
  const byId = new Map(all.map(f => [f.id, f]));
  const selected = new Set(ids);
  const roots = ids.filter(id => {
    if (!byId.has(id)) return false;
    let parent = byId.get(id)!.parentId; const seen = new Set<number>();
    while (parent !== null && !seen.has(parent)) { if (selected.has(parent)) return false; seen.add(parent); parent = byId.get(parent)?.parentId ?? null; }
    return true;
  });
  const deleted: number[] = [];
  const failed: { id: number; error: string }[] = [];
  for (const id of ids) if (!byId.has(id)) failed.push({ id, error: "NOT_FOUND" });
  for (const id of roots) {
    try {
      const treeIds = new Set<number>([id]); let changed = true;
      while (changed) { changed = false; for (const folder of all) if (folder.parentId !== null && treeIds.has(folder.parentId) && !treeIds.has(folder.id)) { treeIds.add(folder.id); changed = true; } }
      const files = await db.file.findMany({ where: { folderId: { in: [...treeIds] }, status: { not: "deleted" } }, select: { id: true } });
      await db.$transaction(async tx => {
        await tx.file.updateMany({ where: { id: { in: files.map(f => f.id) } }, data: { status: "deleted", deletedAt: new Date() } });
        await tx.folder.delete({ where: { id } });
      });
      deleted.push(...treeIds);
    } catch { failed.push({ id, error: "DELETE_FAILED" }); }
  }
  return NextResponse.json({ success: failed.length === 0, deleted: [...new Set(deleted)], failed, semantics: "EXISTING_FOLDER_DELETE" }, { status: failed.length && !deleted.length ? 207 : 200 });
}
