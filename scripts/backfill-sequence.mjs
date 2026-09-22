/**
 * One-time backfill: assign canonical sequential media numbers to File rows
 * created before the /images/ scheme (sequenceNumber IS NULL).
 *
 * - Oldest rows get the lowest numbers (createdAt, id order).
 * - Each number is drawn from MediaSequence (same atomic allocator as live
 *   uploads) — safe to run while the app is serving traffic.
 * - publicUrl is ALWAYS the canonical origin from the single source of truth
 *   (src/lib/media-url.ts, honoring MEDIA_PUBLIC_URL) — never APP_URL/localhost.
 * - Legacy publicId is untouched, so /i/ redirects keep working.
 * - Second pass rewrites the origin of any already-numbered row whose
 *   publicUrl doesn't match the canonical form (repairs localhost-baked URLs).
 * - Idempotent: safe to re-run.
 * - Provider-agnostic: works against SQLite (local) and PostgreSQL (prod) —
 *   same Prisma Client API, no raw SQL.
 *
 * Usage:  bun run db:backfill
 * (bun auto-loads .env; DATABASE_URL resolution matches the app.
 *  bun transpiles the .ts import below natively — keep running via bun.)
 */
import { PrismaClient } from "@prisma/client";
// Single source of truth for the canonical media origin + URL shape —
// no duplicated constants in this file.
import { canonicalUrl } from "../src/lib/media-url.ts";

const prisma = new PrismaClient();

async function main() {
  // Pass 1: allocate numbers for rows missing them.
  const rows = await prisma.file.findMany({
    where: { sequenceNumber: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, mimeType: true },
  });
  console.log(`Backfill pass 1: ${rows.length} file(s) without sequenceNumber.`);

  let done = 0;
  for (const row of rows) {
    const seq = await prisma.mediaSequence.create({ data: {} });
    await prisma.file.update({
      where: { id: row.id },
      data: { sequenceNumber: seq.id, publicUrl: canonicalUrl(seq.id, row.mimeType) },
    });
    done++;
    if (done % 100 === 0) console.log(`  …${done}/${rows.length}`);
  }

  // Pass 2: normalize origin of already-numbered rows (fixes localhost-baked URLs).
  const numbered = await prisma.file.findMany({
    where: { sequenceNumber: { not: null } },
    select: { id: true, sequenceNumber: true, mimeType: true, publicUrl: true },
  });
  let fixed = 0;
  for (const row of numbered) {
    const expected = canonicalUrl(row.sequenceNumber, row.mimeType);
    if (row.publicUrl !== expected) {
      await prisma.file.update({ where: { id: row.id }, data: { publicUrl: expected } });
      fixed++;
    }
  }
  console.log(`Backfill pass 2: normalized ${fixed}/${numbered.length} publicUrl origin(s).`);

  const remaining = await prisma.file.count({ where: { sequenceNumber: null } });
  console.log(`Backfill complete: assigned ${done}, remaining without number: ${remaining}.`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
