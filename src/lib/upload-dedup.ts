import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

const RESERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type UploadReservationResult =
  | { kind: "reserved"; uploadId: string }
  | { kind: "duplicate"; file: { id: number; originalName: string; mimeType: string; publicUrl: string; folderId: number | null } }
  | { kind: "in-progress" };

/**
 * The app's File model is a shared admin library (it has no per-user owner
 * column), so content identity is scoped to that existing shared-library
 * authorization boundary. The unique reservation serializes concurrent uploads
 * before either request sends bytes to Telegram.
 */
export async function reserveUploadHash(sha256: string, uploadId: string = randomUUID()): Promise<UploadReservationResult> {
  // Recover reservations left behind by a process crash. Normal failures
  // release their reservation explicitly; this is a last-resort stale lease.
  await db.uploadReservation.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RESERVATION_MAX_AGE_MS) } },
  });

  const existing = await db.file.findFirst({
    where: { sha256, status: "active" },
    select: { id: true, originalName: true, mimeType: true, publicUrl: true, folderId: true },
  });
  if (existing) return { kind: "duplicate", file: existing };

  try {
    await db.uploadReservation.create({ data: { sha256, uploadId } });
    return { kind: "reserved", uploadId };
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    // Another request owns the unique hash reservation. Recheck the File row
    // because its transaction may have committed while this request waited.
    const committed = await db.file.findFirst({
      where: { sha256, status: "active" },
      select: { id: true, originalName: true, mimeType: true, publicUrl: true, folderId: true },
    });
    return committed ? { kind: "duplicate", file: committed } : { kind: "in-progress" };
  }
}

export async function releaseUploadReservation(uploadId: string): Promise<void> {
  await db.uploadReservation.deleteMany({ where: { uploadId } });
}
