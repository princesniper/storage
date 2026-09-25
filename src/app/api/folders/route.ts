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
    },
  });

  return NextResponse.json({
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      childFolderCount: folder._count.children,
      fileCount: folder._count.files,
    })),
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
