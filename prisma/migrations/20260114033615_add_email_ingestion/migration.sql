-- AlterTable
ALTER TABLE "users" ADD COLUMN     "imap_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imap_folder" TEXT DEFAULT 'INBOX',
ADD COLUMN     "imap_last_uid" INTEGER,
ADD COLUMN     "imap_password_encrypted" TEXT,
ADD COLUMN     "imap_port" INTEGER,
ADD COLUMN     "imap_server" TEXT,
ADD COLUMN     "imap_username" TEXT;

-- CreateIndex
CREATE INDEX "users_imap_enabled_idx" ON "users"("imap_enabled");
