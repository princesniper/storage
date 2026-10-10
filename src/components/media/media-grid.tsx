import { MediaCard, type MediaFile } from "./media-card";
import { cn } from "@/lib/utils";

interface MediaGridProps {
  files: MediaFile[];
  selected?: Set<number>;
  selectionMode?: boolean;
  onSelect?: (id: number) => void;
  onOpen?: (id: number) => void;
  onDelete?: (file: MediaFile) => void;
  className?: string;
}

/**
 * Fluid responsive grid:
 *   2 cols  <640px
 *   3 cols  640-899px
 *   4 cols  900-1199px
 *   5 cols  1200-1439px
 *   6 cols  ≥1440px
 */
export function MediaGrid({ files, selected, selectionMode, onSelect, onOpen, onDelete, className }: MediaGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3",
        "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        className
      )}
      role="list"
      aria-label="Media files"
    >
      {files.map((f, i) => (
        <div key={f.id} role="listitem">
          <MediaCard
            file={f}
            index={i}
            selected={selected?.has(f.id)}
            selectionMode={selectionMode}
            onSelect={onSelect ? () => onSelect(f.id) : undefined}
            onOpen={onOpen ? () => onOpen(f.id) : undefined}
            onDelete={onDelete ? () => onDelete(f) : undefined}
          />
        </div>
      ))}
    </div>
  );
}
