-- jifo:no-transaction
-- Idempotent online repair for databases where 008 was recorded manually or
-- its index is otherwise missing. Existing healthy installations are a no-op.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_plain_text_trgm ON notes USING gin (plain_text gin_trgm_ops);
