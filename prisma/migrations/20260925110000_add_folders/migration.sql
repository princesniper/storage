-- Folder hierarchy foundation
CREATE TABLE "Folder" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Folder_parentId_name_key" ON "Folder"("parentId", "name");
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

ALTER TABLE "File" ADD COLUMN "folderId" INTEGER;
CREATE INDEX "File_folderId_idx" ON "File"("folderId");

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "File" ADD CONSTRAINT "File_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
