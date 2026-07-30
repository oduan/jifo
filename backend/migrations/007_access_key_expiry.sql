-- 007: access key 可选过期时间（NULL = 永久，向后兼容存量 key）
ALTER TABLE access_keys
    ADD COLUMN expires_at timestamptz;
