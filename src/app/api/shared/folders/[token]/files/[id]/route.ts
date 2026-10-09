import { getSharedFolderAccess } from "@/lib/folder-share";
import { findSharedFile, getSharedFileBytes, getSharedFileRange } from "@/lib/shared-media";
import { MAX_VIDEO_RANGE_BYTES } from "@/lib/serve-media";
import { parseByteRange } from "@/lib/http-range";
import { createBoundedPartialResponse } from "@/lib/bounded-range-response";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ token: string; id: string }> }

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function safeFilename(name: string): string {
  return name.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "download";
}

function contentDisposition(name: string, download: boolean): string {
  const safe = safeFilename(name).replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name);
  const quote = String.fromCharCode(34); return (download ? "attachment" : "inline") + "; filename=" + quote + safe.slice(0, 180) + quote + "; filename*=UTF-8''" + encoded;
}

function rangeNotSatisfiable(size: number) {
  return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size, "Accept-Ranges": "bytes" } });
}

export async function GET(req: Request, ctx: RouteContext) {
  const { token, id: rawId } = await ctx.params;
  const access = await getSharedFolderAccess(token);
  if (!access) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });

  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const file = await findSharedFile(id, access.folderIds);
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const isVideo = file.mimeType.startsWith("video/");
  const rangeHeader = req.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": file.mimeType,
    "Content-Disposition": contentDisposition(file.originalName, download),
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
  };

  try {
    if (isVideo && rangeHeader) {
      const range = parseByteRange(rangeHeader, file.size);
      if (!range) return rangeNotSatisfiable(file.size);
      const response = await createBoundedPartialResponse({
        range,
        fileSize: file.size,
        maxBytes: MAX_VIDEO_RANGE_BYTES,
        fetchRange: (start, end) => getSharedFileRange(file, start, end),
        headers: baseHeaders,
      });
      if (!response) return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502 });
      return response;
    }

    // A browser can issue GET without Range. Stream bounded Telegram ranges so
    // this compatibility path never allocates the whole video in Node.js RAM.
    if (isVideo) {
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset >= file.size) { controller.close(); return; }
          const start = offset;
          const end = Math.min(file.size - 1, start + MAX_VIDEO_RANGE_BYTES - 1);
          try {
            const result = await getSharedFileRange(file, start, end);
            if (!result || result.bytes.length !== end - start + 1) throw new Error("RANGE_INCOMPLETE");
            offset += result.bytes.length;
            controller.enqueue(new Uint8Array(result.bytes));
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { ...baseHeaders, "Content-Length": String(file.size), "Accept-Ranges": "bytes" },
      });
    }

    const result = await getSharedFileBytes(file);
    if (!result) return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502 });
    const body = new Uint8Array(result.bytes);
    return new Response(body, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(body.length) },
    });
  } catch {
    return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502 });
  }
}

export async function HEAD(_req: Request, ctx: RouteContext) {
  const { token, id: rawId } = await ctx.params;
  const access = await getSharedFolderAccess(token);
  if (!access) return new Response(null, { status: 404 });
  const id = parseId(rawId);
  if (!id) return new Response(null, { status: 404 });
  const file = await findSharedFile(id, access.folderIds);
  if (!file) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Accept-Ranges": file.mimeType.startsWith("video/") ? "bytes" : "none",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
