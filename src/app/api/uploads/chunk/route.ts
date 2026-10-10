import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { RESUMABLE_CHUNK_SIZE, readUploadManifest, writeUploadChunk } from "@/lib/resumable-upload";
import { rateLimitAsync } from "@/services/rate-limit";
import { getClientIp } from "@/lib/client-ip";

const MAX_CHUNK = RESUMABLE_CHUNK_SIZE;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const ip = getClientIp(req.headers);
  const userId = (session.user as { id?: string; email?: string }).id ?? session.user.email ?? "admin";
  const limit = await rateLimitAsync("upload-chunk:" + userId + ":" + ip, 180, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(limit.resetMs / 1000))) } });

  const uploadId = req.headers.get("x-upload-id")?.trim() ?? "";
  const index = Number(req.headers.get("x-chunk-index"));
  if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "INVALID_CHUNK_REQUEST" }, { status: 400 });
  }

  let manifest;
  try {
    manifest = await readUploadManifest(uploadId);
  } catch {
    return NextResponse.json({ error: "UPLOAD_SESSION_NOT_FOUND" }, { status: 404 });
  }
  if (index >= manifest.totalChunks) return NextResponse.json({ error: "CHUNK_OUT_OF_RANGE" }, { status: 400 });

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_CHUNK) return NextResponse.json({ error: "CHUNK_TOO_LARGE" }, { status: 413 });

  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > MAX_CHUNK) return NextResponse.json({ error: "CHUNK_TOO_LARGE" }, { status: 413 });

  try {
    const result = await writeUploadChunk(uploadId, index, body);
    return NextResponse.json({ success: true, ...result, totalChunks: manifest.totalChunks });
  } catch (error) {
    return NextResponse.json({
      error: "CHUNK_WRITE_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 400 });
  }
}
