import { db } from "@/lib/db";
import { parseFolderShareToken } from "@/lib/folder-share";
import { canonicalUrl } from "@/lib/media-url";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ token: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const token = (await ctx.params).token;
  const folderId = parseFolderShareToken(token);
  if (!folderId) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });

  const folders = await db.folder.findMany({ select: { id: true, name: true, parentId: true } });
  const root = folders.find((folder) => folder.id === folderId);
  if (!root) return NextResponse.json({ error: "FOLDER_NOT_FOUND" }, { status: 404 });

  const ids = new Set<number>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }

  const files = await db.file.findMany({
    where: { folderId: { in: [...ids] }, status: "active" },
    select: { id: true, originalName: true, mimeType: true, size: true, sequenceNumber: true, publicUrl: true, createdAt: true, folderId: true },
    orderBy: { createdAt: "asc" },
  });

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const relativePath = (id: number | null) => {
    const parts: string[] = [];
    let current = id;
    const seen = new Set<number>();
    while (current !== null && current !== folderId && !seen.has(current)) {
      seen.add(current);
      const folder = byId.get(current);
      if (!folder) break;
      parts.unshift(folder.name);
      current = folder.parentId;
    }
    return parts.join("/");
  };

  return NextResponse.json({
    folder: { id: root.id, name: root.name },
    files: files.map((file) => ({
      id: file.id,
      name: file.originalName,
      path: relativePath(file.folderId),
      mimeType: file.mimeType,
      size: Number(file.size),
      url: file.sequenceNumber != null ? canonicalUrl(file.sequenceNumber, file.mimeType) : file.publicUrl,
      createdAt: file.createdAt,
    })),
  }, { headers: { "Cache-Control": "private, max-age=30" } });
}
