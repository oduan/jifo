ALTER TABLE user_sessions
    ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    ADD COLUMN prev_refresh_token_hash text;

CREATE UNIQUE INDEX idx_user_sessions_refresh_hash ON user_sessions (refresh_token_hash);
