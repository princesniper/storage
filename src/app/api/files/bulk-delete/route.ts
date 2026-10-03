/**
 * POST /api/files/bulk-delete
 * Auth: required
 * Body: { ids: number[] }  // max 100 per call
 * Response: { success: true, deleted: number[], failed: { id: number, error: string }[] }
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramService } from "@/services/telegram";
import { audit } from "@/services/audit";
import { cache } from "@/lib/cache";
import { formatSequence } from "@/lib/media-url";
import { rateLimit } from "@/services/rate-limit";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(5000),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const adminEmail = (session.user as { email?: string }).email ?? "";

  // Rate limit: 10 bulk-delete calls/min/admin
  const rl = rateLimit(`bulk-delete:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterMs: rl.resetMs },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const { ids } = parsed.data;

  const admin = await db.admin.findFirst({ where: { email: adminEmail } });

  const deleted: number[] = [];
  const failed: { id: number; error: string }[] = [];

  // Fetch all requested files with channel info
  const files = await db.file.findMany({
    where: { id: { in: ids } },
    include: { storageChannel: { select: { telegramChannelId: true } } },
  });
  const byId = new Map(files.map((f) => [f.id, f]));

  for (const id of ids) {
    const file = byId.get(id);
    if (!file) {
      failed.push({ id, error: "NOT_FOUND" });
      continue;
    }
    if (file.status === "deleted") {
      failed.push({ id, error: "ALREADY_DELETED" });
      continue;
    }
    try {
      // DB update inside a transaction per file (keeps each independent)
      await db.$transaction([
        db.file.update({
          where: { id: file.id },
          data: { status: "deleted", deletedAt: new Date() },
        }),
      ]);
      if (file.sequenceNumber != null) {
        await cache.invalidate(formatSequence(file.sequenceNumber));
      } else {
        await cache.invalidate(file.publicId);
      }

      let telegramDeleteOk = false;
      let telegramDeleteError: string | undefined;
      if (telegramService.getStatus() === "connected") {
        try {
          await telegramService.deleteMessage(
            file.storageChannel.telegramChannelId,
            file.telegramMessageId
          );
          telegramDeleteOk = true;
        } catch (e) {
          telegramDeleteError = e instanceof Error ? e.message : String(e);
          logger.warn("Telegram bulk-delete failed for file (DB marked deleted anyway)", {
            err: telegramDeleteError,
            fileId: file.id,
          });
        }
      }

      await audit({
        operation: "DELETE",
        status: telegramDeleteOk ? "SUCCESS" : "PARTIAL",
        ip,
        fileId: file.id,
        adminId: admin?.id,
        errorMessage: telegramDeleteError,
        metadata: { publicId: file.publicId, telegramDeleted: telegramDeleteOk, bulk: true },
      });

      deleted.push(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("bulk-delete failed for file", { err: msg, fileId: id });
      failed.push({ id, error: msg });
    }
  }

  return NextResponse.json({ success: true, deleted, failed });
}
