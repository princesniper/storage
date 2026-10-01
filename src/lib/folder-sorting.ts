export type FolderSortKey =
  | "name:asc"
  | "name:desc"
  | "created:desc"
  | "created:asc"
  | "modified:desc"
  | "modified:asc"
  | "size:desc"
  | "size:asc";

export const FOLDER_SORT_OPTIONS: { value: FolderSortKey; label: string }[] = [
  { value: "name:asc", label: "Name: A–Z" },
  { value: "name:desc", label: "Name: Z–A" },
  { value: "created:desc", label: "Date created: newest first" },
  { value: "created:asc", label: "Date created: oldest first" },
  { value: "modified:desc", label: "Last modified: newest first" },
  { value: "modified:asc", label: "Last modified: oldest first" },
  { value: "size:desc", label: "Largest first" },
  { value: "size:asc", label: "Smallest first" },
];

export const FOLDER_MIME_OPTIONS = [
  { value: "all", label: "All" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WEBP" },
  { value: "image/gif", label: "GIF" },
  { value: "video/mp4", label: "MP4" },
  { value: "video/webm", label: "WEBM" },
  { value: "video/quicktime", label: "MOV" },
];

export type SortableItem = {
  id: number;
  name?: string;
  originalName?: string;
  size?: number;
  totalSize?: number;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  lastModified?: string | Date | null;
};

function timestamp(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortByMetadata<T extends SortableItem>(items: readonly T[], sort: FolderSortKey): T[] {
  const [field, direction] = sort.split(":") as ["name" | "created" | "modified" | "size", "asc" | "desc"];
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (field === "name") {
      const leftName = a.name ?? a.originalName ?? "";
      const rightName = b.name ?? b.originalName ?? "";
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base", numeric: true }) * multiplier || a.id - b.id;
    }
    if (field === "size") {
      const leftSize = a.size ?? a.totalSize ?? null;
      const rightSize = b.size ?? b.totalSize ?? null;
      if (leftSize === null || rightSize === null) return leftSize === rightSize ? a.id - b.id : leftSize === null ? 1 : -1;
      return (leftSize - rightSize) * multiplier || a.id - b.id;
    }
    const getDate = (item: T) => field === "created" ? timestamp(item.createdAt) : timestamp(item.lastModified) ?? timestamp(item.updatedAt);
    const left = getDate(a);
    const right = getDate(b);
    // Unknown/invalid dates always sort last, independent of direction.
    if (left === null || right === null) return left === right ? a.id - b.id : left === null ? 1 : -1;
    return (left - right) * multiplier || a.id - b.id;
  });
}
