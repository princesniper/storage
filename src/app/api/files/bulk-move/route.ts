import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100), folderId: z.number().int().positive().nullable() });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY", detail: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  const destinationId = parsed.data.folderId;
  if (destinationId !== null && !await db.folder.findUnique({ where: { id: destinationId }, select: { id: true } })) {
    return NextResponse.json({ error: "INVALID_DESTINATION" }, { status: 400 });
  }
  const files = await db.file.findMany({ where: { id: { in: ids } }, select: { id: true, originalName: true, status: true, folderId: true } });
  const byId = new Map(files.map((f) => [f.id, f]));
  const moved: number[] = [];
  const failed: { id: number; error: string }[] = [];
  const destinationNames = new Set((await db.file.findMany({
    where: { folderId: destinationId, status: { not: "deleted" }, id: { notIn: ids } },
    select: { originalName: true },
  })).map((f) => f.originalName.toLocaleLowerCase()));
  for (const id of ids) {
    const file = byId.get(id);
    if (!file) { failed.push({ id, error: "NOT_FOUND" }); continue; }
    if (file.status !== "active") { failed.push({ id, error: "FILE_NOT_ACTIVE" }); continue; }
    if (file.folderId === destinationId) { failed.push({ id, error: "ALREADY_IN_DESTINATION" }); continue; }
    const key = file.originalName.toLocaleLowerCase();
    if (destinationNames.has(key)) { failed.push({ id, error: "NAME_CONFLICT" }); continue; }
    try {
      await db.file.update({ where: { id }, data: { folderId: destinationId } });
      destinationNames.add(key);
      moved.push(id);
    } catch {
      failed.push({ id, error: "MOVE_FAILED" });
    }
  }
  return NextResponse.json({ success: failed.length === 0, moved, failed, destinationId }, { status: moved.length ? 200 : failed.length ? 207 : 200 });
}
