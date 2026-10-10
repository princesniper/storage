import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleFolderIds } from "@/lib/active-library";
import { createFolderShareToken, decryptFolderShareToken, encryptFolderShareToken, hashFolderShareToken } from "@/lib/folder-share";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function shareUrl(token: string): string {
  const configured = (process.env.SHARE_PUBLIC_URL ?? "").trim();
  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN ?? "").trim();
  const appUrl = (process.env.APP_URL ?? "").trim();
  const isLocal = (value: string) => /^(https?:\/\/)?(localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/i.test(value.replace(/\/+$/, ""));
  const origin =
    configured ||
    (process.env.NODE_ENV === "production" && railwayDomain && railwayDomain !== "m.media-growplants.com" ? `https://${railwayDomain}` : "") ||
    (process.env.NODE_ENV === "production" && isLocal(appUrl) ? "https://growplants-media.up.railway.app" : appUrl) ||
    "https://growplants-media.up.railway.app";
  const normalized = origin.replace(/\/+$/, "");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("SHARE_PUBLIC_URL must use http(s)");
  if (process.env.NODE_ENV === "production" && isLocal(normalized)) throw new Error("SHARE_PUBLIC_URL cannot be localhost in production");
  return `${normalized}/shared/folders/${token}`;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  try {
    const active = await db.folderShare.findFirst({
      where: { folderId: id, revokedAt: null },
      select: { id: true, tokenCiphertext: true, createdAt: true, lastAccessedAt: true },
      orderBy: { createdAt: "desc" },
    });
    const token = active ? decryptFolderShareToken(active.tokenCiphertext) : null;
    let url: string | null = null;
    if (token) {
      try { url = shareUrl(token); } catch { url = null; }
    }
    return NextResponse.json({ active: Boolean(active), share: active ? { id: active.id, createdAt: active.createdAt, lastAccessedAt: active.lastAccessedAt, url, recoverable: Boolean(token) } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Allow the manager to display and revoke legacy links while a deployment's
    // database has not yet applied the optional encrypted-token migration.
    if (error && typeof error === "object" && "code" in error && error.code === "P2022") {
      try {
        const legacy = await db.folderShare.findFirst({
          where: { folderId: id, revokedAt: null },
          select: { id: true, createdAt: true, lastAccessedAt: true },
          orderBy: { createdAt: "desc" },
        });
        return NextResponse.json({
          active: Boolean(legacy),
          share: legacy ? { id: legacy.id, createdAt: legacy.createdAt, lastAccessedAt: legacy.lastAccessedAt, url: null, recoverable: false } : null,
          warning: "SHARE_TOKEN_MIGRATION_REQUIRED",
        }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        // Fall through to a safe JSON error.
      }
    }
    return NextResponse.json({ error: "SHARE_STATUS_LOAD_FAILED", message: "Could not load share status. Check the server logs and database migration state." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const token = createFolderShareToken();
  let url: string;
  try { url = shareUrl(token); } catch { return NextResponse.json({ error: "SHARE_URL_CONFIG_INVALID" }, { status: 500 }); }
  let created: { id: number; createdAt: Date };
  try {
    created = await db.$transaction(async (tx) => {
      await tx.folderShare.updateMany({ where: { folderId: folder.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.folderShare.create({ data: { folderId: folder.id, tokenHash: hashFolderShareToken(token), tokenCiphertext: encryptFolderShareToken(token) }, select: { id: true, createdAt: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2022") {
      return NextResponse.json({ error: "SHARE_TOKEN_MIGRATION_REQUIRED", message: "The database is missing the folder share token migration. Apply pending Prisma migrations, then retry." }, { status: 503 });
    }
    return NextResponse.json({ error: "SHARE_CREATE_FAILED", message: "The share link could not be created. Please retry." }, { status: 500 });
  }
  return NextResponse.json({ success: true, folder: { id: folder.id, name: folder.name }, shareId: created.id, createdAt: created.createdAt, url }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const result = await db.folderShare.updateMany({ where: { folderId: folder.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (result.count === 0) return NextResponse.json({ error: "NO_ACTIVE_SHARE" }, { status: 404 });
  return NextResponse.json({ success: true, revoked: true });
}
