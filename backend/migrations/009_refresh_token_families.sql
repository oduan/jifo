-- Refresh-token family rows permit a short retry/concurrency grace window
-- without storing any token in plaintext.
CREATE TABLE session_refresh_tokens (
    token_hash text PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    reuse_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_refresh_tokens_session ON session_refresh_tokens(session_id, created_at DESC);

INSERT INTO session_refresh_tokens (token_hash, session_id, expires_at)
SELECT refresh_token_hash, id, expires_at
FROM user_sessions
WHERE revoked_at IS NULL
ON CONFLICT (token_hash) DO NOTHING;

-- Preserve replay detection for tokens rotated before this migration. They
-- are already used, so any future presentation must revoke the session.
INSERT INTO session_refresh_tokens (token_hash, session_id, expires_at, used_at, reuse_until)
SELECT prev_refresh_token_hash, id, expires_at, now(), now() - interval '1 second'
FROM user_sessions
WHERE revoked_at IS NULL AND prev_refresh_token_hash IS NOT NULL
ON CONFLICT (token_hash) DO NOTHING;
