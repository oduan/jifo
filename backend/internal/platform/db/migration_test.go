package db

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
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
