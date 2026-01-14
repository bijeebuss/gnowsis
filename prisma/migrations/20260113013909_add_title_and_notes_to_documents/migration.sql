-- DropIndex
DROP INDEX "vectors_dense_vector_ivfflat_idx";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "title" TEXT;
