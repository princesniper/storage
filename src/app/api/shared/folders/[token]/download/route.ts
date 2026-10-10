import { db } from "@/lib/db";
import { getVisibleFolderIds, withNonRemovedStorageChannel } from "@/lib/active-library";
import { getSharedFolderAccess } from "@/lib/folder-share";
import { findSharedFile, getSharedFileBytes } from "@/lib/shared-media";
import { createZipStream, type ZipEntry } from "@/lib/zip";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ token: string }> }

function zipPath(folderName: string, relative: string, fileName?: string) {
  return [folderName, relative, fileName].filter(Boolean).join("/");
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { token } = await ctx.params;
  const access = await getSharedFolderAccess(token);
  if (!access) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });
  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(access.folderId)) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });
  const allowedFolderIds = [...access.folderIds].filter((id) => visibleFolderIds.has(id));

  const folders = await db.folder.findMany({
    where: { id: { in: allowedFolderIds } },
    select: { id: true, name: true, parentId: true },
    orderBy: { id: "asc" },
  });
  const files = await db.file.findMany({
    where: withNonRemovedStorageChannel({ folderId: { in: allowedFolderIds }, status: "active" }),
    select: { id: true, originalName: true, folderId: true },
    orderBy: { id: "asc" },
  });

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const relativePath = (id: number | null) => {
    const parts: string[] = [];
    let current = id;
    const seen = new Set<number>();
    while (current !== null && current !== access.folderId && !seen.has(current)) {
      seen.add(current);
      const folder = byId.get(current);
      if (!folder) break;
      parts.unshift(folder.name);
      current = folder.parentId;
    }
    return parts.join("/");
  };

  const entries: ZipEntry[] = [];
  for (const folder of folders) {
    if (folder.id !== access.folderId) entries.push({ name: zipPath(access.folder.name, relativePath(folder.id)) + "/", directory: true });
  }
  for (const file of files) {
    const sharedFile = await findSharedFile(file.id, access.folderIds);
    if (!sharedFile) continue;
    entries.push({
      name: zipPath(access.folder.name, relativePath(file.folderId), file.originalName),
      getBytes: async () => {
        const result = await getSharedFileBytes(sharedFile);
        if (!result) throw new Error("STORAGE_UNAVAILABLE");
        return result.bytes;
      },
    });
  }

  const stream = createZipStream(entries);
  const safeName = access.folder.name.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "folder";
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName.slice(0, 120)}.zip"; filename*=UTF-8''${encodeURIComponent(safeName)}.zip`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
