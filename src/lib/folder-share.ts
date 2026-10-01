import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createFolderShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFolderShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function shareEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to protect share-link recovery data");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptFolderShareToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", shareEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptFolderShareToken(value: string | null): string | null {
  if (!value) return null;
  try {
    const [ivPart, tagPart, encryptedPart, extra] = value.split(".");
    if (!ivPart || !tagPart || !encryptedPart || extra !== undefined) return null;
    const decipher = createDecipheriv("aes-256-gcm", shareEncryptionKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const token = Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
    return TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
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
