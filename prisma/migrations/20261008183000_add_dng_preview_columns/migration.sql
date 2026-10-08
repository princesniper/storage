-- Add the DNG/RAW derived-preview columns that are part of the current File model.
-- Keep this migration additive and idempotent so existing File rows remain untouched.

ALTER TABLE "File" ADD COLUMN "previewStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "File" ADD COLUMN "previewUrl" TEXT;
ALTER TABLE "File" ADD COLUMN "previewMimeType" TEXT;
ALTER TABLE "File" ADD COLUMN "previewSize" INTEGER;
ALTER TABLE "File" ADD COLUMN "previewTelegramMessageId" INTEGER;
ALTER TABLE "File" ADD COLUMN "previewTelegramFileId" TEXT;
ALTER TABLE "File" ADD COLUMN "previewTelegramAccessHash" TEXT;
ALTER TABLE "File" ADD COLUMN "previewTelegramFileReference" TEXT;
ALTER TABLE "File" ADD COLUMN "previewWidth" INTEGER;
ALTER TABLE "File" ADD COLUMN "previewHeight" INTEGER;
ALTER TABLE "File" ADD COLUMN "previewError" TEXT;
ALTER TABLE "File" ADD COLUMN "previewGeneratedAt" TIMESTAMP(3);
ALTER TABLE "File" ADD COLUMN "previewProcessingStartedAt" TIMESTAMP(3);

CREATE INDEX "File_previewStatus_idx" ON "File"("previewStatus");
