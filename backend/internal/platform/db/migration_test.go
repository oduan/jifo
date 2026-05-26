package db

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestInitMigrationEnforcesTenantConsistency(t *testing.T) {
	sql := loadInitMigration(t)

	requiredSnippets := []string{
		"CONSTRAINT user_sessions_id_user_id_unique UNIQUE (id, user_id)",
		"CONSTRAINT notes_id_user_id_unique UNIQUE (id, user_id)",
		"CONSTRAINT media_assets_id_user_id_unique UNIQUE (id, user_id)",
		"CONSTRAINT tags_id_user_id_unique UNIQUE (id, user_id)",
		"FOREIGN KEY (parent_id, user_id) REFERENCES tags(id, user_id) ON DELETE CASCADE",
		"FOREIGN KEY (note_id, user_id) REFERENCES notes(id, user_id) ON DELETE CASCADE",
		"FOREIGN KEY (media_id, user_id) REFERENCES media_assets(id, user_id) ON DELETE CASCADE",
		"FOREIGN KEY (tag_id, user_id) REFERENCES tags(id, user_id) ON DELETE CASCADE",
		"FOREIGN KEY (session_id, user_id) REFERENCES user_sessions(id, user_id) ON DELETE SET NULL (session_id)",
		"FOREIGN KEY (conflict_of_note_id, user_id) REFERENCES notes(id, user_id) ON DELETE SET NULL (conflict_of_note_id)",
		"ALTER TABLE users ADD CONSTRAINT users_avatar_media_fk FOREIGN KEY (avatar_media_id, id) REFERENCES media_assets(id, user_id) ON DELETE SET NULL (avatar_media_id)",
	}

	normalized := normalizeSQL(sql)
	for _, snippet := range requiredSnippets {
		if !strings.Contains(normalized, normalizeSQL(snippet)) {
			t.Fatalf("migration must contain snippet: %s", snippet)
		}
	}
}

func TestInitMigrationExecutesAndCreatesConstraintsWhenDatabaseAvailable(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)

	dropSQL := "DROP TABLE IF EXISTS sync_operations, note_tags, tags, note_media_refs, media_assets, notes, user_sessions, users CASCADE;"
	if _, err := pool.Exec(ctx, dropSQL); err != nil {
		t.Fatalf("drop existing tables: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, dropSQL)
	})

	if _, err := pool.Exec(ctx, loadInitMigration(t)); err != nil {
		t.Fatalf("execute migration: %v", err)
	}

	assertConstraintContains(t, ctx, pool, "notes", "u", "UNIQUE (user_id, client_id)")
	assertConstraintContains(t, ctx, pool, "notes", "u", "UNIQUE (id, user_id)")
	assertConstraintContains(t, ctx, pool, "note_media_refs", "f", "FOREIGN KEY (note_id, user_id) REFERENCES notes(id, user_id)")
	assertConstraintContains(t, ctx, pool, "note_media_refs", "f", "FOREIGN KEY (media_id, user_id) REFERENCES media_assets(id, user_id)")
	assertConstraintContains(t, ctx, pool, "note_tags", "f", "FOREIGN KEY (note_id, user_id) REFERENCES notes(id, user_id)")
	assertConstraintContains(t, ctx, pool, "note_tags", "f", "FOREIGN KEY (tag_id, user_id) REFERENCES tags(id, user_id)")
	assertConstraintContains(t, ctx, pool, "sync_operations", "u", "UNIQUE (user_id, op_id)")
	assertIndexContains(t, ctx, pool, "sync_operations", "idx_sync_operations_user_created", "(user_id, created_at)")
}

func assertConstraintContains(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table string, ctype string, required string) {
	t.Helper()

	rows, err := pool.Query(ctx, `
SELECT pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
WHERE n.nspname = current_schema()
  AND r.relname = $1
  AND c.contype = $2
`, table, ctype)
	if err != nil {
		t.Fatalf("query constraints for %s: %v", table, err)
	}
	defer rows.Close()

	defs := make([]string, 0)
	normalizedRequired := normalizeSQL(required)
	for rows.Next() {
		var def string
		if err := rows.Scan(&def); err != nil {
			t.Fatalf("scan constraint for %s: %v", table, err)
		}
		defs = append(defs, def)
		if strings.Contains(normalizeSQL(def), normalizedRequired) {
			return
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate constraints for %s: %v", table, err)
	}

	t.Fatalf("constraint not found on %s: %q, got: %v", table, required, defs)
}

func assertIndexContains(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table string, indexName string, required string) {
	t.Helper()

	var indexDef string
	err := pool.QueryRow(ctx, `
SELECT indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename = $1
  AND indexname = $2
`, table, indexName).Scan(&indexDef)
	if err != nil {
		t.Fatalf("query index %s on %s: %v", indexName, table, err)
	}

	if !strings.Contains(normalizeSQL(indexDef), normalizeSQL(required)) {
		t.Fatalf("index %s on %s must contain %q, got: %s", indexName, table, required, indexDef)
	}
}

func loadInitMigration(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve caller: failed")
	}

	migrationPath := filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations", "001_init.sql")
	content, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}

	return string(content)
}

func normalizeSQL(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}
