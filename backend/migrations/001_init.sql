CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    username text NOT NULL,
    avatar_media_id uuid,
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_code text NOT NULL,
    device_name text NOT NULL,
    refresh_token_hash text NOT NULL,
    jwt_version bigint NOT NULL DEFAULT 1,
    revoked_at timestamptz,
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user_device ON user_sessions(user_id, device_code);
CREATE INDEX idx_user_sessions_user_revoked ON user_sessions(user_id, revoked_at);

CREATE TABLE notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id text NOT NULL,
    content jsonb NOT NULL,
    plain_text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    purge_after timestamptz,
    permanently_deleted_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    conflict_of_note_id uuid REFERENCES notes(id),
    conflict_reason text,
    UNIQUE(user_id, client_id)
);

CREATE INDEX idx_notes_user_updated_id ON notes(user_id, updated_at, id);
CREATE INDEX idx_notes_user_deleted_purge ON notes(user_id, deleted_at, purge_after);
CREATE INDEX idx_notes_user_permanently_deleted ON notes(user_id, permanently_deleted_at);

CREATE TABLE media_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    storage_key text NOT NULL,
    checksum text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    purge_after timestamptz,
    purged_at timestamptz
);

CREATE INDEX idx_media_assets_user_deleted_purge ON media_assets(user_id, deleted_at, purge_after);
CREATE INDEX idx_media_assets_user_purged ON media_assets(user_id, purged_at);

CREATE TABLE note_media_refs (
    note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (note_id, media_id)
);

CREATE INDEX idx_note_media_refs_user_media ON note_media_refs(user_id, media_id);

CREATE TABLE tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    path text NOT NULL,
    parent_id uuid REFERENCES tags(id) ON DELETE CASCADE,
    depth integer NOT NULL,
    note_count integer NOT NULL DEFAULT 0,
    pinned boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, path)
);

CREATE INDEX idx_tags_user_parent_sort ON tags(user_id, parent_id, sort_order);
CREATE INDEX idx_tags_user_pinned_sort ON tags(user_id, pinned, sort_order);

CREATE TABLE note_tags (
    note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, note_id, tag_id)
);

CREATE INDEX idx_note_tags_user_tag_note ON note_tags(user_id, tag_id, note_id);

CREATE TABLE sync_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id uuid REFERENCES user_sessions(id) ON DELETE SET NULL,
    op_id text NOT NULL,
    entity text NOT NULL,
    action text NOT NULL,
    entity_id uuid,
    client_id text,
    base_version bigint,
    status text NOT NULL,
    result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, op_id)
);

CREATE INDEX idx_sync_operations_user_created ON sync_operations(user_id, created_at);
