-- jifo:no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_user_trash_created_id
    ON notes(user_id, created_at DESC, id DESC)
    WHERE deleted_at IS NOT NULL AND permanently_deleted_at IS NULL;
