/**
 * GET /api/folders/:id
 * PATCH /api/folders/:id { name?, parentId? }
 * DELETE /api/folders/:id
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleFolderIds, withNonRemovedStorageChannel } from "@/lib/active-library";
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

async function getSubtreeFolderIds(folderId: number): Promise<number[]> {
  const allFolders = await db.folder.findMany({ select: { id: true, parentId: true } });
  const ids = new Set<number>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of allFolders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

async function subtreeContainsRemovedChannelFiles(folderIds: number[]): Promise<boolean> {
  const file = await db.file.findFirst({
    where: {
      folderId: { in: folderIds },
      storageChannel: { is: { status: "removed" } },
    },
    select: { id: true },
  });
  return Boolean(file);
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

  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const folder = await db.folder.findUnique({
    where: { id },
    include: { parent: { select: { id: true, name: true, parentId: true } } },
  });
  if (!folder) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const [childFolderCount, visibleFileCount] = await Promise.all([
    db.folder.count({ where: { parentId: id, id: { in: [...visibleFolderIds] } } }),
    db.file.count({ where: withNonRemovedStorageChannel({ folderId: id, status: "active" }) }),
  ]);

  return NextResponse.json({
    folder: { ...folder, _count: { children: childFolderCount, files: visibleFileCount } },
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
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

  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const existing = await db.folder.findUnique({ where: { id }, select: { id: true, parentId: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (body.parentId != null && !visibleFolderIds.has(body.parentId)) {
    return NextResponse.json({ error: "PARENT_NOT_FOUND" }, { status: 404 });
  }
  const movedSubtreeIds = await getSubtreeFolderIds(id);
  if (await subtreeContainsRemovedChannelFiles(movedSubtreeIds)) {
    return NextResponse.json({ error: "FOLDER_HAS_REMOVED_CHANNEL_DATA", detail: "This folder tree includes preserved media from a removed storage channel. Reconnect that channel before restructuring this tree." }, { status: 409 });
  }

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

  const visibleFolderIds = await getVisibleFolderIds(db);
  if (!visibleFolderIds.has(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const existing = await db.folder.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Delete the complete folder subtree. Files are marked deleted first so
  // public media URLs stop working immediately; Telegram deletion is best-effort.
  const allFolders = await db.folder.findMany({ select: { id: true, parentId: true } });
  const folderIds = new Set<number>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of allFolders) {
      if (folder.parentId !== null && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    }
  }

  if (await subtreeContainsRemovedChannelFiles([...folderIds])) {
    return NextResponse.json({ error: "FOLDER_HAS_REMOVED_CHANNEL_DATA", detail: "This folder tree includes preserved media from a removed storage channel. Reconnect that channel before deleting the tree." }, { status: 409 });
  }

  const files = await db.file.findMany({
    where: withNonRemovedStorageChannel({ folderId: { in: [...folderIds] }, status: { not: "deleted" } }),
    select: {
      id: true,
      publicId: true,
      sequenceNumber: true,
      telegramMessageId: true,
      storageChannel: { select: { telegramChannelId: true } },
    },
  });

  await db.file.updateMany({
    where: { id: { in: files.map((file) => file.id) } },
    data: { status: "deleted", deletedAt: new Date() },
  });

  let telegramDeleted = 0;
  const telegramErrors: string[] = [];
  try {
    const { telegramService } = await import("@/services/telegram");
    const { cache } = await import("@/lib/cache");
    const { formatSequence } = await import("@/lib/media-url");

    if (telegramService.getStatus() !== "connected") await telegramService.ensureStarted();
    for (const file of files) {
      await cache.invalidate(file.sequenceNumber != null ? formatSequence(file.sequenceNumber) : file.publicId);
      if (telegramService.getStatus() !== "connected") continue;
      try {
        await telegramService.deleteMessage(file.storageChannel.telegramChannelId, file.telegramMessageId);
        telegramDeleted++;
      } catch (error) {
        telegramErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    telegramErrors.push(error instanceof Error ? error.message : String(error));
  }

  await db.folder.delete({ where: { id } });

  return NextResponse.json({
    success: true,
    folderId: id,
    deletedFolders: folderIds.size,
    deletedFiles: files.length,
    telegramDeleted,
    telegramErrors: telegramErrors.length ? telegramErrors : undefined,
  });
}
