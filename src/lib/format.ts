/**
 * Shared formatting helpers — single source of truth.
 * (Previously copy-pasted across upload/files/dashboard/audit components.)
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string | Date): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return String(iso);
  }
}

export function formatDateTime(iso: string | Date): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export function shortMime(mime: string): string {
  const parts = mime.split("/");
  return parts.length > 1 ? parts[1].toUpperCase() : mime;
}

export function isVideoMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("video/");
}

export function isAudioMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("audio/");
}
