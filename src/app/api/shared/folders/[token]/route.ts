import { getSharedFolderAccess } from "@/lib/folder-share";
import { db } from "@/lib/db";
import { getVisibleFolderIds, withNonRemovedStorageChannel } from "@/lib/active-library";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ token: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const token = (await ctx.params).token;
  const access = await getSharedFolderAccess(token);
  if (!access) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });
  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(access.folderId)) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });
  const allowedFolderIds = [...access.folderIds].filter((id) => visibleFolderIds.has(id));
  const files = await db.file.findMany({
    where: withNonRemovedStorageChannel({ folderId: { in: allowedFolderIds }, status: "active" }),
    select: { id: true, originalName: true, mimeType: true, size: true, sequenceNumber: true, createdAt: true, updatedAt: true, folderId: true },
    orderBy: { createdAt: "asc" },
  });
  const folders = await db.folder.findMany({ where: { id: { in: allowedFolderIds } }, select: { id: true, name: true, parentId: true } });
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
  return NextResponse.json({
    folder: { id: access.folder.id, name: access.folder.name },
    files: files.map((file) => ({
      id: file.id,
      name: file.originalName,
      path: relativePath(file.folderId),
      mimeType: file.mimeType,
      size: Number(file.size),
      url: `/api/shared/folders/${encodeURIComponent(token)}/files/${file.id}`,
      downloadUrl: `/api/shared/folders/${encodeURIComponent(token)}/files/${file.id}?download=1`,
      createdAt: file.createdAt,
      lastModified: file.updatedAt,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
