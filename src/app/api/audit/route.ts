/**
 * GET /api/audit?page=&limit=&operation=&status=&from=&to=&search=
 * Admin-only. Joins Admin + File for display names.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/services/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

const OPERATIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "UPLOAD",
  "DELETE",
  "CHANNEL_ADD",
  "CHANNEL_DELETE",
  "CHANNEL_TEST",
  "CHANNEL_UPDATE",
  "TELEGRAM_CONNECT",
  "TELEGRAM_DISCONNECT",
  "TELEGRAM_ERROR",
] as const;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  operation: z.string().max(50).optional().default("all"),
  status: z.enum(["SUCCESS", "FAILED", "PARTIAL", "all"]).optional().default("all"),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().max(200).optional().default(""),
});

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  // Rate limit: 60/min/admin
  if (!rateLimit(`audit:${ip}`, 60, 60_000).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const q = parsed.data;
  const search = q.search.trim();

  const where: Record<string, unknown> = {};
  if (q.operation !== "all") {
    if (!(OPERATIONS as readonly string[]).includes(q.operation)) {
      return NextResponse.json({ error: "INVALID_OPERATION" }, { status: 400 });
    }
    where.operation = q.operation;
  }
  if (q.status !== "all") where.status = q.status;
  if (q.from || q.to) {
    const createdFilter: Record<string, Date> = {};
    if (q.from) {
      const d = new Date(q.from);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "INVALID_FROM_DATE" }, { status: 400 });
      createdFilter.gte = d;
    }
    if (q.to) {
      const d = new Date(q.to);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "INVALID_TO_DATE" }, { status: 400 });
      createdFilter.lte = d;
    }
    if (createdFilter.gte && createdFilter.lte && createdFilter.gte > createdFilter.lte) {
      return NextResponse.json({ error: "INVALID_DATE_RANGE" }, { status: 400 });
    }
    where.createdAt = createdFilter;
  }
  if (search) {
    where.OR = [
      { errorMessage: { contains: search } },
      { operation: { contains: search } },
      { ip: { contains: search } },
    ];
  }

  const [logs, total] = await Promise.all([
    db.uploadLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: {
        admin: { select: { email: true } },
        file: { select: { id: true, publicId: true, originalName: true } },
      },
    }),
    db.uploadLog.count({ where }),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      operation: l.operation,
      status: l.status,
      errorMessage: l.errorMessage,
      ip: l.ip,
      createdAt: l.createdAt,
      adminEmail: l.admin?.email ?? null,
      file: l.file
        ? { id: l.file.id, publicId: l.file.publicId, originalName: l.file.originalName }
        : null,
    })),
    total,
    page: q.page,
    limit: q.limit,
  });
}
