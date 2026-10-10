/**
 * GET /api/folders?parentId=<id>&all=true
 * POST /api/folders { name, parentId? }
 *
 * Folder rows are global and do not have a StorageChannel FK. Visibility is
 * derived from existing File -> StorageChannel relationships so removed-only
 * branches are hidden while shared trees remain visible for other channels.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleFolderIds } from "@/lib/active-library";
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

const visibleFileWhere = {
  status: "active",
  storageChannel: { is: { status: { not: "removed" } } },
} as const;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const requestUrl = new URL(req.url);
  const all = requestUrl.searchParams.get("all") === "true";
  const parentId = parseParentId(requestUrl.searchParams.get("parentId"));
  if (parentId === "invalid") {
    return NextResponse.json({ error: "INVALID_PARENT_ID" }, { status: 400 });
  }

  const visibleIds = await getVisibleFolderIds(db);
  if (parentId !== null && !visibleIds.has(parentId)) {
    return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 404 });
  }

  // Compute subtree totals from visible descendants only; a relational _count
  // would include removed-channel children and leave stale badges in the UI.
  const allRows = await db.folder.findMany({
    where: { id: { in: [...visibleIds] } },
    orderBy: { name: "asc" },
    include: {
      files: { where: visibleFileWhere, select: { size: true, createdAt: true, updatedAt: true } },
    },
  });

  const byId = new Map(allRows.map((folder) => [folder.id, folder]));
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
    if (!row) {
      visiting.delete(id);
      return { files: 0, folders: 0, size: 0, modified: new Date(0) };
    }

    let result = {
      files: row.files.length,
      folders: 0,
      size: row.files.reduce((sum, file) => sum + Number(file.size), 0),
      modified: row.files.reduce((latest, file) => {
        const date = file.updatedAt ?? file.createdAt;
        return date > latest ? date : latest;
      }, row.updatedAt),
    };

    const children = childrenByParent.get(id) ?? [];
    result.folders = children.length;
    for (const child of children) {
      const sub = calculate(child.id);
      result = {
        files: result.files + sub.files,
        folders: result.folders + sub.folders,
        size: result.size + sub.size,
        modified: sub.modified > result.modified ? sub.modified : result.modified,
      };
    }

    visiting.delete(id);
    totals.set(id, result);
    return result;
  };

  const folders = all ? allRows : allRows.filter((folder) => folder.parentId === parentId);
  return NextResponse.json({
    folders: folders.map((folder) => {
      const total = calculate(folder.id);
      return {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        childFolderCount: (childrenByParent.get(folder.id) ?? []).length,
        fileCount: folder.files.length,
        totalFileCount: total.files,
        totalFolderCount: total.folders,
        totalSize: total.size,
        lastModified: total.modified,
      };
    }),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
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
    const visibleIds = await getVisibleFolderIds(db);
    if (!visibleIds.has(body.parentId)) {
      return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 404 });
    }
  }

  try {
    const folder = await db.folder.create({
      data: { name: body.name, parentId: body.parentId ?? null },
    });
    return NextResponse.json({ folder }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Folder_parentId_name_key")) {
      return NextResponse.json({ error: "FOLDER_ALREADY_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 });
  }
}
