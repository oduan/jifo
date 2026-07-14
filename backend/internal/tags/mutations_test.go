package tags

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/testutil"
)

func TestRewriteTagTokensRenamesSelectedPathAndDescendants(t *testing.T) {
	got := rewriteTagTokens("#工作 #工作/前端 #工作台", "工作", "项目")
	want := "#项目 #项目/前端 #工作台"
	if got != want {
		t.Fatalf("rewriteTagTokens() = %q, want %q", got, want)
	}
}

func TestRewriteTagTokensDeletesOnlySelectedPathPrefix(t *testing.T) {
	got := rewriteTagTokens("保留 #工作 删除 #工作/前端 以及 #工作台", "工作", "")
	want := "保留  删除  以及 #工作台"
	if got != want {
		t.Fatalf("rewriteTagTokens() = %q, want %q", got, want)
	}
}

func TestNormalizeTagPath(t *testing.T) {
	if got, ok := normalizeTagPath(" 项目 / 前端 "); !ok || got != "项目/前端" {
		t.Fatalf("normalizeTagPath() = %q, %v", got, ok)
	}
	for _, invalid := range []string{"", "#项目", "项目 名称", "项目//前端"} {
		if _, ok := normalizeTagPath(invalid); ok {
			t.Fatalf("normalizeTagPath(%q) unexpectedly valid", invalid)
		}
	}
}

func TestRenameAndDeleteTagUpdateAffectedNotes(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := uuid.New()
	noteID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO users (id, email, password_hash, username) VALUES ($1, $2, 'hash', 'tag-user')`, userID, "mutation@example.com"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	content := `{"blocks":[{"type":"paragraph","text":"内容 #工作/前端"}]}`
	if _, err := db.Exec(ctx, `
		INSERT INTO notes (id, user_id, client_id, content, plain_text)
		VALUES ($1, $2, 'mutation-note', $3::jsonb, '内容 #工作/前端')
	`, noteID, userID, content); err != nil {
		t.Fatalf("insert note: %v", err)
	}

	svc := NewService(db)
	ids, err := svc.EnsurePaths(ctx, userID, []string{"工作/前端"})
	if err != nil {
		t.Fatalf("EnsurePaths: %v", err)
	}
	for _, id := range ids {
		if _, err := db.Exec(ctx, `INSERT INTO note_tags (user_id, note_id, tag_id) VALUES ($1, $2, $3)`, userID, noteID, id); err != nil {
			t.Fatalf("insert note tag: %v", err)
		}
	}

	if err := svc.Rename(ctx, userID, ids["工作"], "项目"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	var plainText string
	var storedContent string
	if err := db.QueryRow(ctx, `SELECT plain_text, content::text FROM notes WHERE id = $1`, noteID).Scan(&plainText, &storedContent); err != nil {
		t.Fatalf("query renamed note: %v", err)
	}
	if plainText != "内容 #项目/前端" || !strings.Contains(storedContent, "#项目/前端") {
		t.Fatalf("renamed note = %q, %q", plainText, storedContent)
	}

	var renamedID uuid.UUID
	if err := db.QueryRow(ctx, `SELECT id FROM tags WHERE user_id = $1 AND path = '项目'`, userID).Scan(&renamedID); err != nil {
		t.Fatalf("query renamed tag: %v", err)
	}
	if err := svc.Delete(ctx, userID, renamedID, false); err != nil {
		t.Fatalf("Delete tag only: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT plain_text FROM notes WHERE id = $1`, noteID).Scan(&plainText); err != nil {
		t.Fatalf("query note after tag deletion: %v", err)
	}
	if strings.Contains(plainText, "#项目") {
		t.Fatalf("deleted tag remains in note: %q", plainText)
	}

	deleteNoteID := uuid.New()
	deleteContent := `{"blocks":[{"type":"paragraph","text":"#清理"}]}`
	if _, err := db.Exec(ctx, `
		INSERT INTO notes (id, user_id, client_id, content, plain_text)
		VALUES ($1, $2, 'delete-with-tag', $3::jsonb, '#清理')
	`, deleteNoteID, userID, deleteContent); err != nil {
		t.Fatalf("insert note for delete: %v", err)
	}
	deleteIDs, err := svc.EnsurePaths(ctx, userID, []string{"清理"})
	if err != nil {
		t.Fatalf("EnsurePaths for delete: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO note_tags (user_id, note_id, tag_id) VALUES ($1, $2, $3)`, userID, deleteNoteID, deleteIDs["清理"]); err != nil {
		t.Fatalf("insert deleting note tag: %v", err)
	}
	if err := svc.Delete(ctx, userID, deleteIDs["清理"], true); err != nil {
		t.Fatalf("Delete tag and notes: %v", err)
	}
	var movedToTrash bool
	if err := db.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM notes WHERE id = $1`, deleteNoteID).Scan(&movedToTrash); err != nil {
		t.Fatalf("query deleted note: %v", err)
	}
	if !movedToTrash {
		t.Fatal("note was not moved to trash")
	}
}
