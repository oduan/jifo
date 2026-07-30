-- 008: 为 plain_text 模糊搜索建立 pg_trgm GIN 索引，加速 ILIKE 查询
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_notes_plain_text_trgm ON notes USING gin (plain_text gin_trgm_ops);
