-- Permanently deleted notes must not retain user content; keep only tombstone metadata.
UPDATE notes
SET content = '{"blocks":[]}'::jsonb,
    plain_text = ''
WHERE permanently_deleted_at IS NOT NULL
  AND (plain_text <> '' OR content <> '{"blocks":[]}'::jsonb);
