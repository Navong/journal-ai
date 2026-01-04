-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "audio_s3_key" TEXT;

-- CreateIndex
CREATE INDEX "journal_entries_audio_s3_key_idx" ON "journal_entries"("audio_s3_key");
