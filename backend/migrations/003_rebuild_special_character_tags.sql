CREATE TEMP TABLE parsed_note_tag_paths (
    user_id uuid NOT NULL,
    note_id uuid NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    parent_path text,
    depth integer NOT NULL,
    PRIMARY KEY (user_id, note_id, path)
) ON COMMIT DROP;

WITH raw_tags AS (
    SELECT
        n.user_id,
        n.id AS note_id,
        matches.ordinality AS match_order,
        matches.captures[1] AS raw_path
    FROM notes n
    CROSS JOIN LATERAL regexp_matches(n.plain_text, '#([^#[:space:]]+)', 'g')
        WITH ORDINALITY AS matches(captures, ordinality)
    WHERE n.permanently_deleted_at IS NULL
),
parts AS (
    SELECT
        raw.user_id,
        raw.note_id,
        raw.match_order,
        pieces.ordinality AS part_order,
        btrim(pieces.part) AS name
    FROM raw_tags raw
    CROSS JOIN LATERAL regexp_split_to_table(raw.raw_path, '/')
        WITH ORDINALITY AS pieces(part, ordinality)
    WHERE btrim(pieces.part) <> ''
),
expanded_paths AS (
    SELECT
        user_id,
        note_id,
        name,
        part_order::integer AS depth,
        string_agg(name, '/') OVER (
            PARTITION BY user_id, note_id, match_order
            ORDER BY part_order
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS path
    FROM parts
)
INSERT INTO parsed_note_tag_paths (user_id, note_id, name, path, parent_path, depth)
SELECT DISTINCT
    user_id,
    note_id,
    name,
    path,
    CASE WHEN depth = 1 THEN NULL ELSE regexp_replace(path, '/[^/]+$', '') END,
    depth
FROM expanded_paths
ON CONFLICT (user_id, note_id, path) DO NOTHING;

DO $$
DECLARE
    current_depth integer := 1;
    maximum_depth integer;
BEGIN
    SELECT COALESCE(max(depth), 0) INTO maximum_depth FROM parsed_note_tag_paths;

    WHILE current_depth <= maximum_depth LOOP
        INSERT INTO tags (user_id, name, path, parent_id, depth)
        SELECT DISTINCT
            parsed.user_id,
            parsed.name,
            parsed.path,
            parent.id,
            parsed.depth
        FROM parsed_note_tag_paths parsed
        LEFT JOIN tags parent
            ON parent.user_id = parsed.user_id
           AND parent.path = parsed.parent_path
        WHERE parsed.depth = current_depth
        ON CONFLICT (user_id, path) DO UPDATE SET
            name = EXCLUDED.name,
            parent_id = EXCLUDED.parent_id,
            depth = EXCLUDED.depth,
            updated_at = now();

        current_depth := current_depth + 1;
    END LOOP;
END $$;

DELETE FROM note_tags;

INSERT INTO note_tags (user_id, note_id, tag_id)
SELECT parsed.user_id, parsed.note_id, tags.id
FROM parsed_note_tag_paths parsed
JOIN tags
  ON tags.user_id = parsed.user_id
 AND tags.path = parsed.path
ON CONFLICT (user_id, note_id, tag_id) DO NOTHING;

UPDATE tags
SET note_count = counts.note_count,
    updated_at = now()
FROM (
    SELECT tags.id, count(note_tags.note_id)::integer AS note_count
    FROM tags
    LEFT JOIN note_tags
      ON note_tags.user_id = tags.user_id
     AND note_tags.tag_id = tags.id
    GROUP BY tags.id
) counts
WHERE tags.id = counts.id;
