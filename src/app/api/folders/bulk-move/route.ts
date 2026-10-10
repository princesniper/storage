import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleFolderIds } from "@/lib/active-library";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100), parentId: z.number().int().positive().nullable() });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY", detail: parsed.error.issues.map(x => x.message).join("; ") }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  const destinationId = parsed.data.parentId;
  const visibleFolderIds = await getVisibleFolderIds(db);
  const folders = await db.folder.findMany({ select: { id: true, name: true, parentId: true } });
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  if (destinationId !== null && (!byId.has(destinationId) || !visibleFolderIds.has(destinationId))) return NextResponse.json({ error: "INVALID_DESTINATION" }, { status: 400 });
  const selected = new Set(ids);
  const isNested = (folder: { id: number; parentId: number | null }) => {
    let parent = folder.parentId; const seen = new Set<number>();
    while (parent !== null && !seen.has(parent)) { if (selected.has(parent)) return true; seen.add(parent); parent = byId.get(parent)?.parentId ?? null; }
    return false;
  };
  const roots = ids.filter(id => byId.has(id) && !isNested(byId.get(id)!));
  const moved: number[] = [];
  const failed: { id: number; error: string }[] = [];
  const reserved = new Set(folders.filter(f => f.parentId === destinationId && !selected.has(f.id)).map(f => f.name.toLocaleLowerCase()));
  for (const id of ids) {
    if (!byId.has(id) || !visibleFolderIds.has(id)) { failed.push({ id, error: "NOT_FOUND" }); continue; }
    if (!roots.includes(id)) { moved.push(id); continue; }
    const folder = byId.get(id)!;
    const treeIds = new Set<number>([id]);
    let treeChanged = true;
    while (treeChanged) {
      treeChanged = false;
      for (const child of folders) {
        if (child.parentId !== null && treeIds.has(child.parentId) && !treeIds.has(child.id)) {
          treeIds.add(child.id);
          treeChanged = true;
        }
      }
    }
    const removedChannelFile = await db.file.findFirst({
      where: { folderId: { in: [...treeIds] }, storageChannel: { is: { status: "removed" } } },
      select: { id: true },
    });
    if (removedChannelFile) { failed.push({ id, error: "FOLDER_HAS_REMOVED_CHANNEL_DATA" }); continue; }
    if (folder.parentId === destinationId) { failed.push({ id, error: "ALREADY_IN_DESTINATION" }); continue; }
    let parent = destinationId; const seen = new Set<number>(); let cycle = false;
    while (parent !== null && !seen.has(parent)) { if (parent === id) { cycle = true; break; } seen.add(parent); parent = byId.get(parent)?.parentId ?? null; }
    if (cycle) { failed.push({ id, error: "FOLDER_CYCLE" }); continue; }
    const key = folder.name.toLocaleLowerCase();
    if (reserved.has(key)) { failed.push({ id, error: "NAME_CONFLICT" }); continue; }
    try { await db.folder.update({ where: { id }, data: { parentId: destinationId } }); reserved.add(key); moved.push(id); }
    catch (error) { const message = error instanceof Error ? error.message : ""; failed.push({ id, error: message.includes("Folder_parentId_name_key") ? "NAME_CONFLICT" : "MOVE_FAILED" }); }
  }
  return NextResponse.json({ success: failed.length === 0, moved, failed, destinationId }, { status: failed.length && !moved.length ? 207 : 200 });
}
