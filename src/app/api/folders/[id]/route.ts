/**
 * GET /api/folders/:id
 * PATCH /api/folders/:id { name?, parentId? }
 * DELETE /api/folders/:id
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

interface RouteContext { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parentId: z.number().int().positive().nullable().optional(),
}).refine((v) => v.name !== undefined || v.parentId !== undefined, {
  message: "At least one field is required",
});

function parseId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function hasAncestor(folderId: number, candidateParentId: number): Promise<boolean> {
  let current: number | null = candidateParentId;
  const seen = new Set<number>();
  while (current !== null) {
    if (current === folderId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const row = await db.folder.findUnique({ where: { id: current }, select: { parentId: true } });
    current = row?.parentId ?? null;
  }
  return false;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });

  const folder = await db.folder.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true, parentId: true } },
      _count: { select: { children: true, files: true } },
    },
  });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ folder });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json({
      error: "INVALID_REQUEST",
      detail: error instanceof Error ? error.message : "Invalid request",
    }, { status: 400 });
  }

  const existing = await db.folder.findUnique({ where: { id }, select: { id: true, parentId: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (body.parentId !== undefined && body.parentId !== null) {
    if (body.parentId === id || await hasAncestor(id, body.parentId)) {
      return NextResponse.json({ error: "FOLDER_CYCLE" }, { status: 400 });
    }
    const parent = await db.folder.findUnique({ where: { id: body.parentId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 404 });
  }

  try {
    const folder = await db.folder.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      },
    });
    return NextResponse.json({ folder });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Folder_parentId_name_key")) {
      return NextResponse.json({ error: "FOLDER_ALREADY_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });

  const existing = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await db.folder.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
