-- Baseline PostgreSQL migration for the Telegram-backed media storage platform.
-- Generated offline via:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- Reviewed: SERIAL primary keys (incl. MediaSequence.id, the sequence allocator),
-- all UNIQUE constraints, indexes, and FK actions match the Prisma schema.
-- Apply on fresh prod DB with:  npx prisma migrate deploy
-- Existing SQLite data moves via the documented import procedure (docs in
-- runbook), followed by setval() resets — never by regenerating sequences.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramAccount" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Primary',
    "phoneReference" TEXT,
    "sessionCipher" TEXT,
    "sessionIV" TEXT,
    "sessionAuthTag" TEXT,
    "apiId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageChannel" (
    "id" SERIAL NOT NULL,
    "telegramAccountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "telegramChannelId" TEXT NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestLatencyMs" INTEGER,
    "lastTestError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "sequenceNumber" INTEGER,
    "storageChannelId" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "telegramMessageId" INTEGER NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "telegramAccessHash" TEXT NOT NULL,
    "telegramFileReference" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnailPublicId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadLog" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER,
    "adminId" INTEGER,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "metadata" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaSequence" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StorageChannel_telegramChannelId_key" ON "StorageChannel"("telegramChannelId");

-- CreateIndex
CREATE INDEX "StorageChannel_telegramAccountId_idx" ON "StorageChannel"("telegramAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "File_publicId_key" ON "File"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "File_sequenceNumber_key" ON "File"("sequenceNumber");

-- CreateIndex
CREATE INDEX "File_storageChannelId_idx" ON "File"("storageChannelId");

-- CreateIndex
CREATE INDEX "File_status_idx" ON "File"("status");

-- CreateIndex
CREATE INDEX "File_createdAt_idx" ON "File"("createdAt");

-- CreateIndex
CREATE INDEX "UploadLog_fileId_idx" ON "UploadLog"("fileId");

-- CreateIndex
CREATE INDEX "UploadLog_adminId_idx" ON "UploadLog"("adminId");

-- CreateIndex
CREATE INDEX "UploadLog_operation_idx" ON "UploadLog"("operation");

-- CreateIndex
CREATE INDEX "UploadLog_createdAt_idx" ON "UploadLog"("createdAt");

-- AddForeignKey
ALTER TABLE "StorageChannel" ADD CONSTRAINT "StorageChannel_telegramAccountId_fkey" FOREIGN KEY ("telegramAccountId") REFERENCES "TelegramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_storageChannelId_fkey" FOREIGN KEY ("storageChannelId") REFERENCES "StorageChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadLog" ADD CONSTRAINT "UploadLog_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadLog" ADD CONSTRAINT "UploadLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
