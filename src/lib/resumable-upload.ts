import { promises as fs } from "fs";
import { createWriteStream } from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { isRawFileName } from "@/lib/raw";

// Keep each browser -> Railway request small enough for slow/mobile links.
// One MiB still keeps an 800 MB upload within the 1024-chunk session limit.
export const RESUMABLE_CHUNK_SIZE = 256 * 1024;
export const RAW_RESUMABLE_CHUNK_SIZE = 64 * 1024;

export type UploadManifest = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  size: number;
  totalChunks: number;
  channelId: number;
  folderId: number | null;
  relativePath: string | null;
  createdAt: number;
};

const ROOT = path.join(os.tmpdir(), "growplants-resumable");

function assertUploadId(uploadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("Invalid upload id");
}

export function uploadDirectory(uploadId: string) {
  assertUploadId(uploadId);
  return path.join(ROOT, uploadId);
}

export function manifestPath(uploadId: string) {
  return path.join(uploadDirectory(uploadId), "manifest.json");
}

export function chunkPath(uploadId: string, index: number) {
  if (!Number.isInteger(index) || index < 0) throw new Error("Invalid chunk index");
  return path.join(uploadDirectory(uploadId), "chunks", String(index).padStart(8, "0") + ".part");
}

export function assembledPath(uploadId: string) {
  return path.join(uploadDirectory(uploadId), "assembled.bin");
}

export async function createUploadManifest(input: Omit<UploadManifest, "uploadId" | "createdAt">) {
  await fs.mkdir(path.join(ROOT), { recursive: true });
  const uploadId = randomUUID();
  const dir = uploadDirectory(uploadId);
  await fs.mkdir(path.join(dir, "chunks"), { recursive: true });
  const manifest: UploadManifest = { ...input, uploadId, createdAt: Date.now() };
  await fs.writeFile(manifestPath(uploadId), JSON.stringify(manifest), "utf8");
  return manifest;
}

export async function readUploadManifest(uploadId: string): Promise<UploadManifest> {
  const raw = await fs.readFile(manifestPath(uploadId), "utf8");
  const manifest = JSON.parse(raw) as UploadManifest;
  if (manifest.uploadId !== uploadId) throw new Error("Upload manifest mismatch");
  return manifest;
}

export async function writeUploadChunk(uploadId: string, index: number, bytes: Uint8Array) {
  const manifest = await readUploadManifest(uploadId);
  if (index >= manifest.totalChunks) throw new Error("Chunk index out of range");
  const chunkSize = isRawFileName(manifest.fileName) ? RAW_RESUMABLE_CHUNK_SIZE : RESUMABLE_CHUNK_SIZE;
  const expected = index === manifest.totalChunks - 1
    ? manifest.size - index * chunkSize
    : chunkSize;
  if (bytes.byteLength !== expected) {
    throw new Error(`Invalid chunk size: expected ${expected}, received ${bytes.byteLength}`);
  }
  await fs.writeFile(chunkPath(uploadId, index), bytes);
  return { index, receivedBytes: bytes.byteLength };
}

export async function hasUploadChunk(uploadId: string, index: number) {
  try {
    const stat = await fs.stat(chunkPath(uploadId, index));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function assembleUpload(uploadId: string): Promise<string> {
  const manifest = await readUploadManifest(uploadId);
  const output = assembledPath(uploadId);
  const handle = await fs.open(output, "w");
  try {
    let total = 0;
    for (let index = 0; index < manifest.totalChunks; index += 1) {
      const source = chunkPath(uploadId, index);
      const stat = await fs.stat(source);
      const chunkSize = isRawFileName(manifest.fileName) ? RAW_RESUMABLE_CHUNK_SIZE : RESUMABLE_CHUNK_SIZE;
      const expected = index === manifest.totalChunks - 1
        ? manifest.size - index * chunkSize
        : chunkSize;
      if (stat.size !== expected) throw new Error(`Chunk ${index} is incomplete`);
      const data = await fs.readFile(source);
      await handle.write(data);
      total += data.length;
    }
    if (total !== manifest.size) throw new Error("Assembled file size mismatch");
  } finally {
    await handle.close();
  }
  return output;
}export async function countUploadChunks(uploadId: string) {
  const manifest = await readUploadManifest(uploadId);
  let count = 0;
  let bytes = 0;
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    try {
      const stat = await fs.stat(chunkPath(uploadId, index));
      if (stat.isFile()) {
        count += 1;
        bytes += stat.size;
      }
    } catch {}
  }
  return { count, bytes, total: manifest.totalChunks, size: manifest.size };
}

export async function cleanupUpload(uploadId: string) {
  await fs.rm(uploadDirectory(uploadId), { recursive: true, force: true });
}

export async function readFileHead(filePath: string, length = 4100) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function copyFileToTemp(source: string, target: string) {
  await pipeline(
    (await import("fs")).createReadStream(source),
    createWriteStream(target)
  );
}
