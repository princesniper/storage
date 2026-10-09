-- Concurrency-safe reservations prevent identical content from being
-- uploaded to Telegram by simultaneous requests. File.sha256 already exists.
CREATE TABLE "UploadReservation" (
    "sha256" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadReservation_pkey" PRIMARY KEY ("sha256")
);

CREATE UNIQUE INDEX "UploadReservation_uploadId_key"
    ON "UploadReservation"("uploadId");
CREATE INDEX "UploadReservation_createdAt_idx"
    ON "UploadReservation"("createdAt");
CREATE INDEX "File_sha256_status_idx"
    ON "File"("sha256", "status");
