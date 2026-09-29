import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { createFolderShareToken, hashFolderShareToken } from "@/lib/folder-share";
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
    (process.env.NODE_ENV === "production" && railwayDomain ? `https://${railwayDomain}` : "") ||
    configured ||
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
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const active = await db.folderShare.findFirst({
    where: { folderId: id, revokedAt: null },
    select: { id: true, createdAt: true, lastAccessedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ active: Boolean(active), share: active ?? null });
}

export async function POST(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const token = createFolderShareToken();
  try {
    await db.$transaction(async (tx) => {
      await tx.folderShare.updateMany({ where: { folderId: folder.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.folderShare.create({ data: { folderId: folder.id, tokenHash: hashFolderShareToken(token) } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch {
    return NextResponse.json({ error: "SHARE_CREATE_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ success: true, folder: { id: folder.id, name: folder.name }, token, url: shareUrl(token) });
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
