CREATE TABLE "FolderShare" (
    "id" SERIAL NOT NULL,
    "folderId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    CONSTRAINT "FolderShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FolderShare_tokenHash_key" ON "FolderShare"("tokenHash");
CREATE INDEX "FolderShare_folderId_idx" ON "FolderShare"("folderId");
CREATE INDEX "FolderShare_folderId_revokedAt_idx" ON "FolderShare"("folderId", "revokedAt");
ALTER TABLE "FolderShare" ADD CONSTRAINT "FolderShare_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
