import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSharedFileBytes, findSharedFile } from "@/lib/shared-media";
import { createZipStream, type ZipEntry } from "@/lib/zip";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }

function zipPath(folderName: string, relative: string, fileName?: string) {
  return [folderName, relative, fileName].filter(Boolean).join("/");
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await ctx.params;
  const folderId = Number(id);
  if (!Number.isInteger(folderId) || folderId <= 0) {
    return NextResponse.json({ error: "INVALID_FOLDER_ID" }, { status: 400 });
  }

  const root = await db.folder.findUnique({ where: { id: folderId }, select: { id: true, name: true } });
  if (!root) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const folders = await db.folder.findMany({
    select: { id: true, name: true, parentId: true },
    orderBy: { id: "asc" },
  });

  const folderIds = new Set<number>([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId !== null && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    }
  }

  const includedFolders = folders.filter((folder) => folderIds.has(folder.id));
  const files = await db.file.findMany({
    where: { folderId: { in: [...folderIds] }, status: "active" },
    select: { id: true, originalName: true, folderId: true },
    orderBy: { id: "asc" },
  });

  const byId = new Map(includedFolders.map((folder) => [folder.id, folder]));
  const relativePath = (id: number | null) => {
    const parts: string[] = [];
    let current = id;
    const seen = new Set<number>();
    while (current !== null && current !== root.id && !seen.has(current)) {
      seen.add(current);
      const folder = byId.get(current);
      if (!folder) break;
      parts.unshift(folder.name);
      current = folder.parentId;
    }
    return parts.join("/");
  };

  const entries: ZipEntry[] = [];
  for (const folder of includedFolders) {
    if (folder.id !== root.id) {
      entries.push({ name: zipPath(root.name, relativePath(folder.id)) + "/", directory: true });
    }
  }

  for (const file of files) {
    if (file.folderId === null) continue;
    const downloadable = await findSharedFile(file.id, folderIds);
    if (!downloadable) continue;
    entries.push({
      name: zipPath(root.name, relativePath(file.folderId), file.originalName),
      getBytes: async () => {
        const result = await getSharedFileBytes(downloadable);
        if (!result) throw new Error("STORAGE_UNAVAILABLE");
        return result.bytes;
      },
    });
  }

  const stream = createZipStream(entries);
  const safeName = root.name.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "folder";
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName.slice(0, 120)}.zip"; filename*=UTF-8''${encodeURIComponent(safeName.slice(0, 120))}.zip`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
