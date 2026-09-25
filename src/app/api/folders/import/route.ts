import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  rootName: z.string().min(1).max(255),
  folderPaths: z.array(z.string().min(1).max(4096)).max(10000),
});

function normalizePart(part: string): string {
  return part.normalize("NFC").trim();
}

function parsePath(value: string): string[] {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("ABSOLUTE_PATH");
  }
  const parts = normalized.split("/").map(normalizePart).filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || p.includes("\0"))) {
    throw new Error("INVALID_PATH");
  }
  return parts;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  let rootName = normalizePart(body.rootName);
  if (!rootName || rootName === "." || rootName === ".." || rootName.includes("/") || rootName.includes("\\") || rootName.includes("\0")) {
    return NextResponse.json({ error: "INVALID_ROOT_NAME" }, { status: 400 });
  }

  const parsedPaths = new Set<string>();
  try {
    for (const raw of body.folderPaths) {
      const parts = parsePath(raw);
      if (parts[0] !== rootName) {
        return NextResponse.json({ error: "ROOT_MISMATCH" }, { status: 400 });
      }
      parsedPaths.add(parts.join("/"));
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "INVALID_PATH" }, { status: 400 });
  }

  parsedPaths.add(rootName);
  const ordered = [...parsedPaths].sort((a, b) => {
    const depthDiff = a.split("/").length - b.split("/").length;
    return depthDiff || a.localeCompare(b);
  });

  const folderIds: Record<string, number> = {};
  console.info("[FolderUpload] Resolving folder tree", { root: rootName, folders: ordered.length });

  try {
    await db.$transaction(async (tx) => {
      for (const fullPath of ordered) {
        const parts = fullPath.split("/");
        const name = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join("/");
        const parentId = parentPath ? folderIds[parentPath] : null;
        if (parentPath && !parentId) throw new Error("PARENT_FOLDER_NOT_RESOLVED");

        let folder = await tx.folder.findFirst({
          where: { name, parentId },
          select: { id: true },
        });

        if (!folder) {
          try {
            folder = await tx.folder.create({
              data: { name, parentId },
              select: { id: true },
            });
            console.info("[FolderUpload] Created folder", { path: fullPath, id: folder.id });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("Folder_parentId_name_key") && !message.includes("Folder_root_name_key")) throw error;
            folder = await tx.folder.findFirst({
              where: { name, parentId },
              select: { id: true },
            });
            if (!folder) throw error;
          }
        }

        folderIds[fullPath] = folder.id;
      }
    }, {
      maxWait: 15000,
      timeout: 30000,
    });
  } catch (error) {
    console.error("[FolderUpload] Folder tree resolution failed", error);
    return NextResponse.json({ error: "FOLDER_TREE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    rootName,
    rootId: folderIds[rootName],
    folderIds,
  });
}
