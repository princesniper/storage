import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { cache } from "@/lib/cache";
import { formatSequence } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";
import { createZipStream } from "@/lib/zip";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(25) });
const MAX_FILES = 500;
const MAX_BYTES = 512 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "DOWNLOAD_LIMIT", detail: "Select between 1 and 25 folders per archive." }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  const folders = await db.folder.findMany({ select: { id: true, name: true, parentId: true } });
  const byId = new Map(folders.map(f => [f.id, f]));
  if (ids.some(id => !byId.has(id))) return NextResponse.json({ error: "FOLDER_UNAVAILABLE", detail: "One or more folders are unavailable. Refresh and retry." }, { status: 409 });
  const selected = new Set(ids);
  const roots = ids.filter(id => {
    let parent = byId.get(id)!.parentId; const seen = new Set<number>();
    while (parent !== null && !seen.has(parent)) { if (selected.has(parent)) return false; seen.add(parent); parent = byId.get(parent)?.parentId ?? null; }
    return true;
  });
  const rootFor = (id: number): number | null => {
    let current: number | null = id; const seen = new Set<number>();
    while (current !== null && !seen.has(current)) {
      if (roots.includes(current)) return current;
      seen.add(current); current = byId.get(current)?.parentId ?? null;
    }
    return null;
  };
  const relativeFolderPath = (id: number) => {
    const rootId = rootFor(id); const parts: string[] = []; let current: number | null = id; const seen = new Set<number>();
    while (current !== null && !seen.has(current)) {
      const row = byId.get(current); if (!row) break;
      parts.unshift(row.name); if (current === rootId) break;
      seen.add(current); current = row.parentId;
    }
    return parts.join("/");
  };
  const included = folders.filter(f => rootFor(f.id) !== null);
  const treeIds = included.map(f => f.id);
  const files = await db.file.findMany({
    where: { folderId: { in: treeIds }, status: "active" },
    select: { id: true, folderId: true, originalName: true, mimeType: true, size: true, sequenceNumber: true, publicId: true, telegramMessageId: true, telegramFileReference: true, storageChannel: { select: { telegramChannelId: true } } },
    orderBy: [{ folderId: "asc" }, { originalName: "asc" }],
  });
  if (files.length > MAX_FILES) return NextResponse.json({ error: "FILE_COUNT_LIMIT", detail: "Selected folders contain more than 500 active files. Select fewer folders.", maxFiles: MAX_FILES }, { status: 413 });
  const totalBytes = files.reduce((sum, f) => sum + Number(f.size), 0);
  if (totalBytes > MAX_BYTES) return NextResponse.json({ error: "DOWNLOAD_SIZE_LIMIT", detail: "Selected folders exceed the 512 MiB archive limit. Download smaller folders.", maxBytes: MAX_BYTES }, { status: 413 });

  const entries: { name: string; directory?: boolean; getBytes?: () => Promise<Buffer> }[] = [];
  const used = new Set<string>();
  const uniqueName = (name: string) => {
    const parts = name.split("/"); const leaf = parts.pop() || "file"; let candidate = name; let i = 1;
    while (used.has(candidate.toLocaleLowerCase())) candidate = [...parts, leaf + " (" + i++ + ")"].join("/");
    used.add(candidate.toLocaleLowerCase()); return candidate;
  };
  for (const id of roots) entries.push({ name: uniqueName(relativeFolderPath(id)) + "/", directory: true });
  for (const folder of included) {
    if (!roots.includes(folder.id)) entries.push({ name: uniqueName(relativeFolderPath(folder.id)) + "/", directory: true });
  }
  for (const file of files) {
    const folderPath = file.folderId === null ? "" : relativeFolderPath(file.folderId);
    entries.push({
      name: uniqueName([folderPath, file.originalName].filter(Boolean).join("/")),
      getBytes: async () => {
        const key = file.sequenceNumber != null ? formatSequence(file.sequenceNumber) : file.publicId;
        const cached = await cache.getBytes(key);
        if (cached) return cached;
        await telegramService.ensureStarted();
        if (telegramService.getStatus() !== "connected") throw new Error("STORAGE_UNAVAILABLE");
        const result = await telegramService.downloadFile(file.storageChannel.telegramChannelId, file.telegramMessageId, file.telegramFileReference);
        if (result.refreshedReferenceB64 && result.refreshedReferenceB64 !== file.telegramFileReference) await db.file.update({ where: { id: file.id }, data: { telegramFileReference: result.refreshedReferenceB64 } });
        await cache.setBytes(key, result.bytes);
        return result.bytes;
      },
    });
  }
  const stream = createZipStream(entries);
  return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="growplants-folders-${new Date().toISOString().slice(0,10)}.zip"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
