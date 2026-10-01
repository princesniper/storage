import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string; shareId: string }>;
}

function parsePositiveId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const params = await context.params;
  const folderId = parsePositiveId(params.id);
  const shareId = parsePositiveId(params.shareId);
  if (!folderId || !shareId) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  // Scope revocation to both the requested share and its owning folder.
  const result = await db.folderShare.updateMany({
    where: { id: shareId, folderId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "ACTIVE_SHARE_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ success: true, revoked: true, shareId });
}
