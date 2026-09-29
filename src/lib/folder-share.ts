import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createFolderShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFolderShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function parseLegacyFolderId(token: string): number | null {
  const match = /^([1-9]\d*)\.[A-Za-z0-9_-]{40,64}$/.exec(token);
  if (!match) return null;
  const folderId = Number(match[1]);
  return Number.isSafeInteger(folderId) && folderId > 0 ? folderId : null;
}

export type ResolvedFolderShare = { folderId: number; shareId: number | null; revoked: boolean; legacy: boolean };

export async function resolveFolderShareToken(token: string): Promise<ResolvedFolderShare | null> {
  if (!TOKEN_PATTERN.test(token)) {
    const legacyFolderId = parseLegacyFolderId(token);
    if (legacyFolderId == null) return null;
    if (await db.folderShare.count({ where: { folderId: legacyFolderId } })) return null;
    const folder = await db.folder.findUnique({ where: { id: legacyFolderId }, select: { id: true } });
    return folder ? { folderId: folder.id, shareId: null, revoked: false, legacy: true } : null;
  }
  const share = await db.folderShare.findUnique({
    where: { tokenHash: hashFolderShareToken(token) },
    select: { id: true, folderId: true, revokedAt: true },
  });
  if (!share) return null;
  return { folderId: share.folderId, shareId: share.id, revoked: share.revokedAt !== null, legacy: false };
}

export async function getSharedFolderIds(rootFolderId: number): Promise<Set<number>> {
  const folders = await db.folder.findMany({ select: { id: true, parentId: true } });
  const ids = new Set<number>([rootFolderId]);
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
  return ids;
}

export async function getSharedFolderAccess(token: string) {
  const share = await resolveFolderShareToken(token);
  if (!share || share.revoked) return null;
  if (share.shareId !== null) {
    void db.folderShare.update({ where: { id: share.shareId }, data: { lastAccessedAt: new Date() } }).catch(() => {});
  }
  const folder = await db.folder.findUnique({ where: { id: share.folderId }, select: { id: true, name: true } });
  if (!folder) return null;
  const folderIds = await getSharedFolderIds(folder.id);
  return { ...share, folder, folderIds };
}
