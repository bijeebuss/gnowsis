-- Session revocation and IMAP checkpoint identity
ALTER TABLE "users"
  ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "imap_uid_validity" TEXT;

ALTER TABLE "documents" ADD COLUMN "source_key" TEXT;
CREATE UNIQUE INDEX "documents_source_key_key" ON "documents"("source_key");

-- Preserve all files belonging to a multi-file document.
CREATE TABLE "document_files" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "filename" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_type" TEXT NOT NULL,
  CONSTRAINT "document_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_files_document_id_fkey" FOREIGN KEY ("document_id")
    REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "document_files_document_id_position_key"
  ON "document_files"("document_id", "position");
CREATE INDEX "document_files_document_id_idx" ON "document_files"("document_id");

-- Backfill the primary file for existing documents.
INSERT INTO "document_files" (
  "id", "document_id", "position", "filename", "original_filename",
  "file_path", "file_size", "file_type"
)
SELECT gen_random_uuid()::text, "id", 0, "filename", "original_filename",
       "file_path", "file_size", "file_type"
FROM "documents"
WHERE "file_path" <> '';

-- Keep one copy of duplicate logical records before enforcing idempotency.
DELETE FROM "vectors" older
USING "vectors" newer
WHERE older."document_id" = newer."document_id"
  AND older."page_number" = newer."page_number"
  AND older."id" < newer."id";

DELETE FROM "metadata_fields" older
USING "metadata_fields" newer
WHERE older."document_id" = newer."document_id"
  AND older."field_name" = newer."field_name"
  AND older."id" < newer."id";

CREATE UNIQUE INDEX "vectors_document_id_page_number_key"
  ON "vectors"("document_id", "page_number");
CREATE UNIQUE INDEX "metadata_fields_document_id_field_name_key"
  ON "metadata_fields"("document_id", "field_name");

-- The title/notes migration unintentionally removed this index.
CREATE INDEX IF NOT EXISTS "vectors_dense_vector_hnsw_idx"
  ON "vectors" USING hnsw ("dense_vector" vector_l2_ops);
