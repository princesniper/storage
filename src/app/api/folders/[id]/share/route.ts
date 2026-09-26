import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { createFolderShareToken } from "@/lib/folder-share";
import { NextResponse } from "next/server";
import { CANONICAL_MEDIA_ORIGIN } from "@/lib/media-url";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });

  const folder = await db.folder.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const token = createFolderShareToken(folder.id);

  // Share links are public application URLs. Never derive them from the
  // incoming request host because Railway/container hosts can be 0.0.0.0:8080.
  const configuredOrigin = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  let publicOrigin = CANONICAL_MEDIA_ORIGIN;
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") publicOrigin = configuredOrigin;
    } catch {
      // Fall back to the known canonical public origin.
    }
  }

  return NextResponse.json({
    success: true,
    folder: { id: folder.id, name: folder.name },
    token,
    url: `${publicOrigin}/shared/folders/${token}`,
  });
}
