CREATE TABLE access_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label text NOT NULL,
    key_hash text NOT NULL UNIQUE,
    key_prefix text NOT NULL,
    key_suffix text NOT NULL,
    masked_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    CONSTRAINT access_keys_label_not_blank CHECK (length(btrim(label)) > 0)
);

CREATE INDEX idx_access_keys_user_created ON access_keys(user_id, created_at DESC);
CREATE INDEX idx_access_keys_user_active ON access_keys(user_id, revoked_at);
