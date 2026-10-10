import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Normal library queries must never return a file whose storage channel has
 * been soft-removed. This is deliberately a read-visibility rule only: the
 * File row, Telegram mapping, sequence, URL and folder relation remain intact.
 */
export const NON_REMOVED_STORAGE_CHANNEL_FILTER = {
  storageChannel: { is: { status: { not: "removed" } } },
} satisfies Prisma.FileWhereInput;

export function withNonRemovedStorageChannel(
  where: Prisma.FileWhereInput = {},
): Prisma.FileWhereInput {
  return {
    AND: [
      where,
      NON_REMOVED_STORAGE_CHANNEL_FILTER,
    ],
  };
}

export interface FolderVisibilityNode {
  id: number;
  parentId: number | null;
}

export interface FolderChannelAssociation {
  folderId: number;
  channelStatus: string;
}

/**
 * Folder has no channel foreign key in the existing schema. Infer visibility
 * from File.folderId and ancestor relationships instead of assigning folders
 * to a channel or rewriting the tree.
 *
 * - A subtree linked only to removed channels is hidden.
 * - A shared subtree stays visible while at least one linked channel remains.
 * - Empty descendants inherit the nearest known ancestor's channel scope.
 * - Entirely unassociated/global empty folders are preserved because the
 *   database contains no evidence that they belong to a removed channel.
 * - Malformed/cyclic trees are handled defensively without infinite loops.
 */
export function calculateVisibleFolderIds(
  folders: readonly FolderVisibilityNode[],
  associations: readonly FolderChannelAssociation[],
): Set<number> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const channelStatusesBySubtree = new Map<number, Set<string>>();

  for (const association of associations) {
    if (!byId.has(association.folderId)) continue;

    let current: number | null = association.folderId;
    const seen = new Set<number>();
    while (current !== null && !seen.has(current)) {
      const folder = byId.get(current);
      if (!folder) break;
      seen.add(current);

      let statuses = channelStatusesBySubtree.get(current);
      if (!statuses) {
        statuses = new Set<string>();
        channelStatusesBySubtree.set(current, statuses);
      }
      statuses.add(association.channelStatus);
      current = folder.parentId;
    }
  }

  const visible = new Set<number>();
  for (const folder of folders) {
    const directSubtreeStatuses = channelStatusesBySubtree.get(folder.id);
    if (directSubtreeStatuses?.size) {
      if ([...directSubtreeStatuses].some((status) => status !== "removed")) {
        visible.add(folder.id);
      }
      continue;
    }

    // No file in this folder's subtree proves its ownership. Inherit from the
    // nearest ancestor which has file evidence; retain truly global empty trees.
    let parentId = folder.parentId;
    const seen = new Set<number>([folder.id]);
    let ancestorScopeFound = false;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;

      const parentStatuses = channelStatusesBySubtree.get(parentId);
      if (parentStatuses?.size) {
        ancestorScopeFound = true;
        if ([...parentStatuses].some((status) => status !== "removed")) {
          visible.add(folder.id);
        }
        break;
      }
      parentId = parent.parentId;
    }

    if (!ancestorScopeFound) visible.add(folder.id);
  }

  return visible;
}

type FolderVisibilityClient = Pick<PrismaClient, "folder" | "file" | "storageChannel">;

/**
 * Fetch compact folder/channel associations. groupBy avoids loading all 7k+
 * File rows for every folder navigation request.
 */
export async function getVisibleFolderIds(
  client: FolderVisibilityClient,
): Promise<Set<number>> {
  const [folders, fileChannelGroups, channels] = await Promise.all([
    client.folder.findMany({ select: { id: true, parentId: true } }),
    client.file.groupBy({
      by: ["folderId", "storageChannelId"],
      where: { folderId: { not: null } },
      _count: { _all: true },
    }),
    client.storageChannel.findMany({ select: { id: true, status: true } }),
  ]);

  const statusByChannelId = new Map(channels.map((channel) => [channel.id, channel.status]));
  const associations: FolderChannelAssociation[] = fileChannelGroups.flatMap((group) => {
    if (group.folderId === null) return [];
    const status = statusByChannelId.get(group.storageChannelId);
    return status === undefined ? [] : [{ folderId: group.folderId, channelStatus: status }];
  });

  return calculateVisibleFolderIds(folders, associations);
}
