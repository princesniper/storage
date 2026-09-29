import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { findSharedFile, getSharedFileBytes } from "@/lib/shared-media";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await ctx.params;
  const fileId = Number(id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return NextResponse.json({ error: "INVALID_FILE_ID" }, { status: 400 });
  }

  const file = await db.file.findUnique({
    where: { id: fileId },
    select: { id: true, folderId: true, originalName: true, mimeType: true, status: true },
  });
  if (!file || file.status !== "active" || file.folderId === null) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const downloadable = await findSharedFile(file.id, new Set([file.folderId]));
  const result = await getSharedFileBytes(downloadable);
  if (!result) return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 503 });

  const safeName = file.originalName.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "download";
  const body = new ArrayBuffer(result.bytes.byteLength);
  new Uint8Array(body).set(result.bytes);
  return new Response(body, {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(result.bytes.length),
      "Content-Disposition": `attachment; filename="${safeName.slice(0, 180)}"; filename*=UTF-8''${encodeURIComponent(safeName.slice(0, 180))}`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
