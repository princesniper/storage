import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { maxFileSizeBytes, maxVideoSizeBytes, isVideoMime, normalizeMimeType } from "@/lib/env";
import { createUploadManifest, RESUMABLE_CHUNK_SIZE } from "@/lib/resumable-upload";

const schema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(200).default("application/octet-stream"),
  size: z.number().int().positive(),
  storageChannelId: z.number().int().positive(),
  folderId: z.number().int().positive().nullable().optional(),
  relativePath: z.string().max(2000).nullable().optional(),
});

function validRelativePath(value: string | null | undefined) {
  if (!value) return true;
  const normalized = value.replaceAll("\\", "/").trim();
  return !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").some((part) => part === "." || part === ".." || part.includes("\0"));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST", detail: parsed.error.message }, { status: 400 });
  const input = parsed.data;
  const mimeType = normalizeMimeType(input.mimeType);
  if (!validRelativePath(input.relativePath)) return NextResponse.json({ error: "INVALID_RELATIVE_PATH" }, { status: 400 });

  const absoluteMax = Math.max(maxFileSizeBytes, maxVideoSizeBytes);
  if (input.size > absoluteMax) {
    return NextResponse.json({ error: "FILE_TOO_LARGE", maxMb: Math.round(absoluteMax / 1024 / 1024), receivedBytes: input.size }, { status: 413 });
  }
  const typeLimit = isVideoMime(mimeType) ? maxVideoSizeBytes : maxFileSizeBytes;
  if (input.size > typeLimit) {
    return NextResponse.json({ error: "FILE_TOO_LARGE", maxMb: Math.round(typeLimit / 1024 / 1024), receivedBytes: input.size }, { status: 413 });
  }  const channel = await db.storageChannel.findFirst({
    where: { id: input.storageChannelId, status: "active" },
    select: { id: true },
  });
  if (!channel) return NextResponse.json({ error: "CHANNEL_NOT_FOUND_OR_INACTIVE" }, { status: 400 });

  const folderId = input.folderId ?? null;
  if (folderId !== null) {
    const folder = await db.folder.findUnique({ where: { id: folderId }, select: { id: true } });
    if (!folder) return NextResponse.json({ error: "FOLDER_NOT_FOUND" }, { status: 404 });
  }

  const totalChunks = Math.ceil(input.size / RESUMABLE_CHUNK_SIZE);
  if (totalChunks < 1 || totalChunks > 1024) {
    return NextResponse.json({ error: "TOO_MANY_CHUNKS" }, { status: 413 });
  }

  const manifest = await createUploadManifest({
    fileName: input.fileName,
    mimeType: mimeType || "application/octet-stream",
    size: input.size,
    totalChunks,
    channelId: channel.id,
    folderId,
    relativePath: input.relativePath ?? null,
  });

  return NextResponse.json({
    success: true,
    uploadId: manifest.uploadId,
    chunkSize: RESUMABLE_CHUNK_SIZE,
    totalChunks,
  });
}

export async function GET() {
  return NextResponse.json({ error: "USE_POST_TO_CREATE_SESSION" }, { status: 405 });
}
