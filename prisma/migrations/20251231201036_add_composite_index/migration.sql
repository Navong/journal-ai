-- CreateIndex
CREATE INDEX "journal_entries_user_id_created_at_idx" ON "journal_entries"("user_id", "created_at" DESC);
