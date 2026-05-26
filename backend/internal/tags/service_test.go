package tags

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/platform/testutil"
)

func TestEnsurePathsCreatesParentsAndChildOnce(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	userID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, "tag-user@example.com", "hash", "tag-user")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	svc := NewService(db)
	paths := []string{"电视剧/电视剧1"}

	first, err := svc.EnsurePaths(ctx, userID, paths)
	if err != nil {
		t.Fatalf("first EnsurePaths: %v", err)
	}
	second, err := svc.EnsurePaths(ctx, userID, paths)
	if err != nil {
		t.Fatalf("second EnsurePaths: %v", err)
	}

	if len(first) != 2 {
		t.Fatalf("first mapping size = %d, want 2", len(first))
	}
	if len(second) != 2 {
		t.Fatalf("second mapping size = %d, want 2", len(second))
	}
	if first["电视剧"] != second["电视剧"] {
		t.Fatalf("parent id changed across calls: %s != %s", first["电视剧"], second["电视剧"])
	}
	if first["电视剧/电视剧1"] != second["电视剧/电视剧1"] {
		t.Fatalf("child id changed across calls: %s != %s", first["电视剧/电视剧1"], second["电视剧/电视剧1"])
	}

	type tagRow struct {
		ID       uuid.UUID
		Name     string
		Path     string
		ParentID *uuid.UUID
		Depth    int
	}

	rows, err := db.Query(ctx, `
		SELECT id, name, path, parent_id, depth
		FROM tags
		WHERE user_id = $1
		ORDER BY depth, path
	`, userID)
	if err != nil {
		t.Fatalf("query tags: %v", err)
	}
	defer rows.Close()

	var got []tagRow
	for rows.Next() {
		var r tagRow
		if err := rows.Scan(&r.ID, &r.Name, &r.Path, &r.ParentID, &r.Depth); err != nil {
			t.Fatalf("scan tag row: %v", err)
		}
		got = append(got, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate tag rows: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("tag rows = %d, want 2", len(got))
	}

	parent := got[0]
	if parent.Name != "电视剧" || parent.Path != "电视剧" || parent.Depth != 0 {
		t.Fatalf("unexpected parent row: %#v", parent)
	}
	if parent.ParentID != nil {
		t.Fatalf("parent parent_id = %v, want nil", *parent.ParentID)
	}

	child := got[1]
	if child.Name != "电视剧1" || child.Path != "电视剧/电视剧1" || child.Depth != 1 {
		t.Fatalf("unexpected child row: %#v", child)
	}
	if child.ParentID == nil {
		t.Fatal("child parent_id is nil")
	}
	if *child.ParentID != parent.ID {
		t.Fatalf("child parent_id = %s, want %s", *child.ParentID, parent.ID)
	}
}

func resetSchemaAndMigrate(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()

	dropSQL := "DROP TABLE IF EXISTS sync_operations, note_tags, tags, note_media_refs, media_assets, notes, user_sessions, users CASCADE;"
	if _, err := db.Exec(ctx, dropSQL); err != nil {
		t.Fatalf("drop existing tables: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(ctx, dropSQL)
	})

	if _, err := db.Exec(ctx, loadInitMigration(t)); err != nil {
		t.Fatalf("execute migration: %v", err)
	}
}

func loadInitMigration(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve caller: failed")
	}

	migrationPath := filepath.Join(filepath.Dir(file), "..", "..", "migrations", "001_init.sql")
	content, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}

	return string(content)
}
