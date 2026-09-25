import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("AUTH_SECRET is required for folder sharing");
  return value;
}

function sign(folderId: number) {
  return createHmac("sha256", getSecret()).update(`folder:${folderId}`).digest("base64url");
}

export function createFolderShareToken(folderId: number) {
  return `${folderId}.${sign(folderId)}`;
}

export function parseFolderShareToken(token: string) {
  const match = /^([1-9]\d*)\.([A-Za-z0-9_-]{40,64})$/.exec(token);
  if (!match) return null;
  const folderId = Number(match[1]);
  if (!Number.isSafeInteger(folderId) || folderId <= 0) return null;
  const expected = Buffer.from(sign(folderId));
  const actual = Buffer.from(match[2]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return folderId;
}
