-- PostgreSQL treats NULL values as distinct in the existing
-- @@unique([parentId, name]) constraint. Root folders therefore
-- need a partial unique index so the same root name is reused safely.
CREATE UNIQUE INDEX "Folder_root_name_key"
ON "Folder" ("name")
WHERE "parentId" IS NULL;
