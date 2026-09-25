/**
 * GET /api/folders?parentId=<id>
 * POST /api/folders { name, parentId? }
 *
 * Task 1: authenticated folder hierarchy foundation.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.number().int().positive().nullable().optional(),
});

function parseParentId(value: string | null): number | null | "invalid" {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const requestUrl = new URL(req.url);
  const all = requestUrl.searchParams.get("all") === "true";
  const parentId = parseParentId(requestUrl.searchParams.get("parentId"));
  if (parentId === "invalid") {
    return NextResponse.json({ error: "INVALID_PARENT_ID" }, { status: 400 });
  }

  if (parentId !== null) {
    const parent = await db.folder.findUnique({ where: { id: parentId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 404 });
  }

  const folders = await db.folder.findMany({
    where: all ? undefined : { parentId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { children: true, files: true } },
      files: { select: { size: true, createdAt: true, updatedAt: true } },
    },
  });

  // Calculate recursive folder totals from the same database snapshot. This
  // keeps the UI lightweight while still showing true subtree counts/sizes.
  const allRows = all
    ? folders
    : await db.folder.findMany({
        select: {
          id: true,
          parentId: true,
          files: { select: { size: true, createdAt: true, updatedAt: true } },
          _count: { select: { children: true, files: true } },
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });
  const byId = new Map(allRows.map((f) => [f.id, f]));
  const childrenByParent = new Map<number, typeof allRows>();
  for (const row of allRows) {
    if (row.parentId === null) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }
  const totals = new Map<number, { files: number; folders: number; size: number; modified: Date }>();
  const visiting = new Set<number>();

  const calculate = (id: number): { files: number; folders: number; size: number; modified: Date } => {
    const cached = totals.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { files: 0, folders: 0, size: 0, modified: new Date(0) };
    visiting.add(id);
    const row = byId.get(id);
    if (!row) return { files: 0, folders: 0, size: 0, modified: new Date(0) };
    let result = {
      files: row.files.length,
      folders: row._count.children,
      size: row.files.reduce((sum, f) => sum + Number(f.size), 0),
      modified: row.files.reduce((latest, f) => {
        const d = f.updatedAt ?? f.createdAt;
        return d > latest ? d : latest;
      }, row.updatedAt),
    };
    for (const child of childrenByParent.get(id) ?? []) {
      const sub = calculate(child.id);
      result = {
        files: result.files + sub.files,
        folders: result.folders + 1 + sub.folders,
        size: result.size + sub.size,
        modified: sub.modified > result.modified ? sub.modified : result.modified,
      };
    }
    visiting.delete(id);
    totals.set(id, result);
    return result;
  };

  return NextResponse.json({
    folders: folders.map((folder) => {
      const total = calculate(folder.id);
      return {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        childFolderCount: folder._count.children,
        fileCount: folder._count.files,
        totalFileCount: total.files,
        totalFolderCount: total.folders,
        totalSize: total.size,
        lastModified: total.modified,
      };
    }),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json({
      error: "INVALID_REQUEST",
      detail: error instanceof Error ? error.message : "Invalid request",
    }, { status: 400 });
  }

  if (body.parentId != null) {
    const parent = await db.folder.findUnique({ where: { id: body.parentId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 404 });
  }

  try {
    const folder = await db.folder.create({
      data: { name: body.name, parentId: body.parentId ?? null },
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Folder_parentId_name_key")) {
      return NextResponse.json({ error: "FOLDER_ALREADY_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 });
  }
}
