import { execFile } from "child_process";
import { promisify } from "util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const db = new PrismaClient();

const statements = [
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewStatus" TEXT NOT NULL DEFAULT \'none\'',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewUrl" TEXT',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewMimeType" TEXT',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewSize" INTEGER',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramMessageId" INTEGER',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramFileId" TEXT',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramAccessHash" TEXT',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramFileReference" TEXT',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewWidth" INTEGER',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewHeight" INTEGER',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewError" TEXT',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewGeneratedAt" TIMESTAMP(3)',
  'ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewProcessingStartedAt" TIMESTAMP(3)',
  'CREATE INDEX IF NOT EXISTS "File_previewStatus_idx" ON "File"("previewStatus")',
];

try {
  const prismaBin = "node_modules/prisma/build/index.js";
  // Recover a previously failed migration record before retrying deploy.
  // This is safe for fresh databases too: resolve exits non-zero when there is
  // no failed record, and we intentionally ignore that case.
  try {
    await execFileAsync(
      process.execPath,
      [prismaBin, "migrate", "resolve", "--rolled-back", "20261008183000_add_dng_preview_columns"],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 },
    );
    console.log("[DNG_PREVIEW_SCHEMA] reconciled previous failed migration");
  } catch {
    // No failed migration to reconcile; continue with normal deploy.
  }

  await execFileAsync(process.execPath, [prismaBin, "migrate", "deploy"], { cwd: process.cwd(), maxBuffer: 1024 * 1024 });
  for (const sql of statements) await db.$executeRawUnsafe(sql);
  console.log("[DNG_PREVIEW_SCHEMA] schema ready");
} finally {
  await db.$disconnect();
}
