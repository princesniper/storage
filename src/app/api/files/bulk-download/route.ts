import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { cache } from "@/lib/cache";
import { formatSequence } from "@/lib/media-url";
import { telegramService } from "@/services/telegram";
import { createZipStream } from "@/lib/zip";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(25) });
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "DOWNLOAD_LIMIT", detail: "Select between 1 and 25 files per download." }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  const files = await db.file.findMany({
    where: { id: { in: ids }, status: "active" },
    select: { id: true, originalName: true, mimeType: true, size: true, sequenceNumber: true, publicId: true, telegramMessageId: true, telegramFileReference: true, storageChannel: { select: { telegramChannelId: true } } },
  });
  if (files.length !== ids.length) return NextResponse.json({ error: "FILE_UNAVAILABLE", detail: "One or more selected files are unavailable. Refresh and retry." }, { status: 409 });
  const totalBytes = files.reduce((sum, f) => sum + Number(f.size), 0);
  if (totalBytes > MAX_TOTAL_BYTES) return NextResponse.json({ error: "DOWNLOAD_SIZE_LIMIT", detail: "Selected files exceed the 512 MiB limit. Download smaller batches.", maxBytes: MAX_TOTAL_BYTES }, { status: 413 });

  const getBytes = async (f: typeof files[number]) => {
    const key = f.sequenceNumber != null ? formatSequence(f.sequenceNumber) : f.publicId;
    const cached = await cache.getBytes(key);
    if (cached) return cached;
    await telegramService.ensureStarted();
    if (telegramService.getStatus() !== "connected") throw new Error("STORAGE_UNAVAILABLE");
    const result = await telegramService.downloadFile(f.storageChannel.telegramChannelId, f.telegramMessageId, f.telegramFileReference);
    if (result.refreshedReferenceB64 && result.refreshedReferenceB64 !== f.telegramFileReference) await db.file.update({ where: { id: f.id }, data: { telegramFileReference: result.refreshedReferenceB64 } });
    await cache.setBytes(key, result.bytes);
    return result.bytes;
  };

  if (files.length === 1) {
    try {
      const f = files[0];
      const bytes = await getBytes(f);
      const name = f.originalName.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180) || "download";
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": f.mimeType || "application/octet-stream", "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return NextResponse.json({ error: "STORAGE_UNAVAILABLE", detail: "The selected file could not be read from storage." }, { status: 503 });
    }
  }

  const entries = files.map((f) => ({ name: f.originalName, getBytes: () => getBytes(f) }));
  const stream = createZipStream(entries);
  return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="growplants-media-${new Date().toISOString().slice(0,10)}.zip"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
