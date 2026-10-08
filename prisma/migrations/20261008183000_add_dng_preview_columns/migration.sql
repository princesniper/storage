-- Add the DNG/RAW derived-preview columns that are part of the current File model.
-- Keep this migration additive and idempotent so existing File rows remain untouched.

ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewUrl" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewMimeType" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewSize" INTEGER;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramMessageId" INTEGER;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramFileId" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramAccessHash" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewTelegramFileReference" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewWidth" INTEGER;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewHeight" INTEGER;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewError" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewGeneratedAt" TIMESTAMP(3);
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "previewProcessingStartedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "File_previewStatus_idx" ON "File"("previewStatus");
