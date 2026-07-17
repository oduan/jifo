DELETE FROM note_tags nt
USING notes n
WHERE n.id = nt.note_id
  AND n.user_id = nt.user_id
  AND (n.deleted_at IS NOT NULL OR n.permanently_deleted_at IS NOT NULL);

UPDATE tags t
SET note_count = (
        SELECT count(*)::integer
        FROM note_tags nt
        JOIN notes n
          ON n.id = nt.note_id
         AND n.user_id = nt.user_id
        WHERE nt.user_id = t.user_id
          AND nt.tag_id = t.id
          AND n.deleted_at IS NULL
          AND n.permanently_deleted_at IS NULL
    ),
    updated_at = now();
