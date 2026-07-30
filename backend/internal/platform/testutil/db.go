package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const dropApplicationSchemaSQL = `
	DROP TABLE IF EXISTS
		schema_migrations,
		session_refresh_tokens,
		access_keys,
		sync_operations,
		note_tags,
		tags,
		note_media_refs,
		media_assets,
		notes,
		user_sessions,
		users
	CASCADE
`

func OpenTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// ResetDatabase isolates integration tests that share TEST_DATABASE_URL. Keep
// this list centralized so a newly added migration table cannot survive one
// package's cleanup and break the next package's migration setup.
func ResetDatabase(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, dropApplicationSchemaSQL); err != nil {
		t.Fatalf("reset test database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), dropApplicationSchemaSQL)
	})
}
