import { getSharedFolderAccess } from "@/lib/folder-share";
import { findSharedFile, getSharedFileBytes } from "@/lib/shared-media";
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
  return `${download ? "attachment" : "inline"}; filename="${safe.slice(0, 180)}"; filename*=UTF-8''${encoded}`;
}

function rangeFor(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start || end >= size) return null;
  return { start, end };
}

export async function GET(req: Request, ctx: RouteContext) {
  const { token, id: rawId } = await ctx.params;
  const access = await getSharedFolderAccess(token);
  if (!access) return NextResponse.json({ error: "INVALID_SHARE_LINK" }, { status: 404 });

  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const file = await findSharedFile(id, access.folderIds);
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const result = await getSharedFileBytes(file);
    if (!result) return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502 });

    const download = new URL(req.url).searchParams.get("download") === "1";
    const isVideo = file.mimeType.startsWith("video/");
    const range = isVideo ? rangeFor(req.headers.get("range"), result.bytes.length) : null;
    if (isVideo && req.headers.has("range") && !range) {
      return new Response(JSON.stringify({ error: "INVALID_RANGE" }), {
        status: 416,
        headers: { "Content-Type": "application/json", "Content-Range": `bytes */${result.bytes.length}` },
      });
    }

    const body = range ? result.bytes.subarray(range.start, range.end + 1) : result.bytes;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(body.length),
        "Content-Disposition": contentDisposition(file.originalName, download),
        "Cache-Control": "private, no-store, max-age=0",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(isVideo ? {
          "Accept-Ranges": "bytes",
          ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${result.bytes.length}` } : {}),
        } : {}),
      },
    });
  } catch {
    return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 502 });
  }
}
