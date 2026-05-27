package sync

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/testutil"
	"jifo/backend/internal/tags"
)

func TestPushOpIDIsIdempotentAndReturnsFirstResult(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	sessionID := insertTestSession(t, ctx, db, userID)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)

	op := Operation{
		OpID:     "op-idempotent-1",
		Entity:   "note",
		Action:   "create",
		ClientID: "client-idempotent-1",
		Payload: Payload{
			Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "#A hello"}}},
			PlainText: "#A hello",
		},
	}

	first, err := svc.Push(ctx, userID, &sessionID, op)
	if err != nil {
		t.Fatalf("first Push() error = %v", err)
	}
	second, err := svc.Push(ctx, userID, &sessionID, op)
	if err != nil {
		t.Fatalf("second Push() error = %v", err)
	}

	if first.Status != "created" {
		t.Fatalf("first status = %q, want %q", first.Status, "created")
	}
	if second.Status != first.Status {
		t.Fatalf("second status = %q, want first status %q", second.Status, first.Status)
	}
	if second.NoteID == nil || first.NoteID == nil || *second.NoteID != *first.NoteID {
		t.Fatalf("second note_id = %v, want first note_id %v", second.NoteID, first.NoteID)
	}

	var noteCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notes WHERE user_id = $1`, userID).Scan(&noteCount); err != nil {
		t.Fatalf("count notes: %v", err)
	}
	if noteCount != 1 {
		t.Fatalf("notes count = %d, want 1", noteCount)
	}
}

func TestPushSameOpIDConcurrentOnlyCreatesOneNote(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	sessionID := insertTestSession(t, ctx, db, userID)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)
	op := Operation{
		OpID:     "op-concurrent-1",
		Entity:   "note",
		Action:   "create",
		ClientID: "client-concurrent-1",
		Payload: Payload{
			Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "#并发 hello"}}},
			PlainText: "#并发 hello",
		},
	}

	const workers = 8
	var wg sync.WaitGroup
	results := make([]PushResult, workers)
	errs := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx], errs[idx] = svc.Push(ctx, userID, &sessionID, op)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("Push worker %d error = %v", i, err)
		}
	}
	firstID := results[0].NoteID
	if firstID == nil {
		t.Fatal("first result note_id is nil")
	}
	for i, result := range results {
		if result.Status != "created" {
			t.Fatalf("result[%d].status = %q, want created", i, result.Status)
		}
		if result.NoteID == nil || *result.NoteID != *firstID {
			t.Fatalf("result[%d].note_id = %v, want %s", i, result.NoteID, *firstID)
		}
	}

	var noteCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notes WHERE user_id = $1`, userID).Scan(&noteCount); err != nil {
		t.Fatalf("count notes: %v", err)
	}
	if noteCount != 1 {
		t.Fatalf("notes count = %d, want 1", noteCount)
	}
	var opCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM sync_operations WHERE user_id = $1 AND op_id = $2`, userID, op.OpID).Scan(&opCount); err != nil {
		t.Fatalf("count sync_operations: %v", err)
	}
	if opCount != 1 {
		t.Fatalf("sync_operations count = %d, want 1", opCount)
	}
}

func TestPushCreateDeduplicatesByClientID(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	sessionID := insertTestSession(t, ctx, db, userID)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)

	first, err := svc.Push(ctx, userID, &sessionID, Operation{
		OpID:     "op-client-dedup-1",
		Entity:   "note",
		Action:   "create",
		ClientID: "same-client-id",
		Payload: Payload{
			Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "#重试 首次"}}},
			PlainText: "#重试 首次",
		},
	})
	if err != nil {
		t.Fatalf("first Push() error = %v", err)
	}

	second, err := svc.Push(ctx, userID, &sessionID, Operation{
		OpID:     "op-client-dedup-2",
		Entity:   "note",
		Action:   "create",
		ClientID: "same-client-id",
		Payload: Payload{
			Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "#重试 再试"}}},
			PlainText: "#重试 再试",
		},
	})
	if err != nil {
		t.Fatalf("second Push() error = %v", err)
	}

	if second.Status != "duplicate" {
		t.Fatalf("second status = %q, want %q", second.Status, "duplicate")
	}
	if first.NoteID == nil || second.NoteID == nil || *second.NoteID != *first.NoteID {
		t.Fatalf("second note_id = %v, want first note_id %v", second.NoteID, first.NoteID)
	}

	var noteCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notes WHERE user_id = $1`, userID).Scan(&noteCount); err != nil {
		t.Fatalf("count notes: %v", err)
	}
	if noteCount != 1 {
		t.Fatalf("notes count = %d, want 1", noteCount)
	}
}

func TestPushUpdateVersionConflictCreatesConflictCopy(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	sessionID := insertTestSession(t, ctx, db, userID)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)

	original, err := noteSvc.Create(ctx, notes.CreateInput{
		UserID:    userID,
		ClientID:  "origin-note",
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "#原始 v1"}}},
		PlainText: "#原始 v1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	updated, err := noteSvc.Update(ctx, notes.UpdateInput{
		UserID:    userID,
		NoteID:    original.ID,
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "#原始 v2"}}},
		PlainText: "#原始 v2",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated version = %d, want 2", updated.Version)
	}

	baseVersion := int64(1)
	res, err := svc.Push(ctx, userID, &sessionID, Operation{
		OpID:        "op-update-conflict-1",
		Entity:      "note",
		Action:      "update",
		EntityID:    &updated.ID,
		BaseVersion: &baseVersion,
		Payload: Payload{
			Content: notes.Content{Blocks: []notes.Block{
				{Type: "paragraph", Text: "#冲突 客户端内容"},
				{Type: "paragraph", Text: "第二段"},
			}},
			PlainText: "#冲突 客户端内容\n第二段",
		},
	})
	if err != nil {
		t.Fatalf("Push(update conflict) error = %v", err)
	}

	if res.Status != "conflict_copied" {
		t.Fatalf("status = %q, want %q", res.Status, "conflict_copied")
	}
	if res.NoteID == nil {
		t.Fatal("conflict copy note_id is nil")
	}
	if *res.NoteID == updated.ID {
		t.Fatalf("conflict copy note_id = %s, should differ from original %s", *res.NoteID, updated.ID)
	}

	var originalPlain string
	if err := db.QueryRow(ctx, `SELECT plain_text FROM notes WHERE user_id = $1 AND id = $2`, userID, updated.ID).Scan(&originalPlain); err != nil {
		t.Fatalf("query original note: %v", err)
	}
	if originalPlain != "#原始 v2" {
		t.Fatalf("original plain_text = %q, want unchanged %q", originalPlain, "#原始 v2")
	}

	var copied notes.Note
	var conflictOf *uuid.UUID
	var conflictReason *string
	var ignoredContent []byte
	if err := db.QueryRow(ctx, `
		SELECT id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version, conflict_of_note_id, conflict_reason
		FROM notes
		WHERE user_id = $1 AND id = $2
	`, userID, *res.NoteID).Scan(
		&copied.ID,
		&copied.UserID,
		&copied.ClientID,
		&ignoredContent,
		&copied.PlainText,
		&copied.CreatedAt,
		&copied.UpdatedAt,
		&copied.DeletedAt,
		&copied.PurgeAfter,
		&copied.PermanentlyDeletedAt,
		&copied.Version,
		&conflictOf,
		&conflictReason,
	); err != nil {
		t.Fatalf("query conflict copy note: %v", err)
	}
	if conflictOf == nil || *conflictOf != updated.ID {
		t.Fatalf("conflict_of_note_id = %v, want %s", conflictOf, updated.ID)
	}
	if conflictReason == nil || *conflictReason != "version_conflict" {
		t.Fatalf("conflict_reason = %v, want version_conflict", conflictReason)
	}

	var conflictContentJSON []byte
	if err := db.QueryRow(ctx, `SELECT content FROM notes WHERE user_id = $1 AND id = $2`, userID, *res.NoteID).Scan(&conflictContentJSON); err != nil {
		t.Fatalf("query conflict copy content: %v", err)
	}
	var conflictContent notes.Content
	if err := json.Unmarshal(conflictContentJSON, &conflictContent); err != nil {
		t.Fatalf("unmarshal conflict copy content: %v", err)
	}
	if len(conflictContent.Blocks) < 4 {
		t.Fatalf("conflict copy blocks len = %d, want >= 4", len(conflictContent.Blocks))
	}
	if conflictContent.Blocks[0].Type != "paragraph" || conflictContent.Blocks[0].Text != "这是一条冲突副本，原笔记已在其他设备被更新。" {
		t.Fatalf("block[0] = %#v, want fixed conflict hint paragraph", conflictContent.Blocks[0])
	}
	if conflictContent.Blocks[1].Type != "divider" {
		t.Fatalf("block[1] type = %q, want %q", conflictContent.Blocks[1].Type, "divider")
	}
	if conflictContent.Blocks[2].Type != "paragraph" || conflictContent.Blocks[2].Text != "#冲突 客户端内容" {
		t.Fatalf("block[2] = %#v, want first client block", conflictContent.Blocks[2])
	}
	if conflictContent.Blocks[3].Type != "paragraph" || conflictContent.Blocks[3].Text != "第二段" {
		t.Fatalf("block[3] = %#v, want second client block", conflictContent.Blocks[3])
	}

	var conflictTagCount int
	if err := db.QueryRow(ctx, `SELECT note_count FROM tags WHERE user_id = $1 AND path = $2`, userID, "冲突").Scan(&conflictTagCount); err != nil {
		t.Fatalf("query conflict tag count: %v", err)
	}
	if conflictTagCount != 1 {
		t.Fatalf("tag 冲突 note_count = %d, want 1", conflictTagCount)
	}
}

func TestPushDeleteVersionConflictIsIgnored(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	sessionID := insertTestSession(t, ctx, db, userID)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)

	created, err := noteSvc.Create(ctx, notes.CreateInput{
		UserID:    userID,
		ClientID:  "delete-conflict-origin",
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "v1"}}},
		PlainText: "v1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	updated, err := noteSvc.Update(ctx, notes.UpdateInput{
		UserID:    userID,
		NoteID:    created.ID,
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "v2"}}},
		PlainText: "v2",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	baseVersion := int64(1)
	res, err := svc.Push(ctx, userID, &sessionID, Operation{
		OpID:        "op-delete-conflict-1",
		Entity:      "note",
		Action:      "delete",
		EntityID:    &updated.ID,
		BaseVersion: &baseVersion,
	})
	if err != nil {
		t.Fatalf("Push(delete conflict) error = %v", err)
	}

	if res.Status != "delete_conflict_ignored" {
		t.Fatalf("status = %q, want %q", res.Status, "delete_conflict_ignored")
	}

	var deletedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at FROM notes WHERE user_id = $1 AND id = $2`, userID, updated.ID).Scan(&deletedAt); err != nil {
		t.Fatalf("query deleted_at: %v", err)
	}
	if deletedAt != nil {
		t.Fatalf("deleted_at = %v, want nil", deletedAt)
	}

	var noteCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notes WHERE user_id = $1`, userID).Scan(&noteCount); err != nil {
		t.Fatalf("count notes: %v", err)
	}
	if noteCount != 1 {
		t.Fatalf("notes count = %d, want 1 (no conflict copy for delete)", noteCount)
	}
}

func TestPushRestoreVersionConflictIsIgnored(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	sessionID := insertTestSession(t, ctx, db, userID)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)
	created, err := noteSvc.Create(ctx, notes.CreateInput{UserID: userID, ClientID: "restore-conflict-origin", Content: notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "v1"}}}, PlainText: "v1"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	trashed, err := noteSvc.MoveToTrash(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("MoveToTrash() error = %v", err)
	}

	staleVersion := int64(1)
	res, err := svc.Push(ctx, userID, &sessionID, Operation{OpID: "op-restore-conflict-1", Entity: "note", Action: "restore", EntityID: &created.ID, BaseVersion: &staleVersion})
	if err != nil {
		t.Fatalf("Push(restore conflict) error = %v", err)
	}
	if res.Status != "restore_conflict_ignored" {
		t.Fatalf("status = %q, want restore_conflict_ignored", res.Status)
	}
	if res.Version != trashed.Version {
		t.Fatalf("version = %d, want current trashed version %d", res.Version, trashed.Version)
	}
	var deletedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at FROM notes WHERE user_id = $1 AND id = $2`, userID, created.ID).Scan(&deletedAt); err != nil {
		t.Fatalf("query deleted_at: %v", err)
	}
	if deletedAt == nil {
		t.Fatal("deleted_at is nil, restore conflict should not restore note")
	}
}

func TestPullReturnsNormalAndTombstoneChanges(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	noteSvc := notes.NewService(db, tags.NewService(db))
	svc := NewService(db, noteSvc)

	active, err := noteSvc.Create(ctx, notes.CreateInput{
		UserID:    userID,
		ClientID:  "pull-active",
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "active"}}},
		PlainText: "active",
	})
	if err != nil {
		t.Fatalf("create active note: %v", err)
	}

	trash, err := noteSvc.Create(ctx, notes.CreateInput{
		UserID:    userID,
		ClientID:  "pull-trash",
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "trash"}}},
		PlainText: "trash",
	})
	if err != nil {
		t.Fatalf("create trash note: %v", err)
	}
	if _, err := noteSvc.MoveToTrash(ctx, userID, trash.ID); err != nil {
		t.Fatalf("move trash note to trash: %v", err)
	}

	purged, err := noteSvc.Create(ctx, notes.CreateInput{
		UserID:    userID,
		ClientID:  "pull-purged",
		Content:   notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "purged"}}},
		PlainText: "purged",
	})
	if err != nil {
		t.Fatalf("create purged note: %v", err)
	}
	trashTime := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	noteSvc.SetNowForTest(func() time.Time { return trashTime })
	if _, err := noteSvc.MoveToTrash(ctx, userID, purged.ID); err != nil {
		t.Fatalf("move purged note to trash: %v", err)
	}
	noteSvc.SetNowForTest(func() time.Time { return trashTime.Add(31 * 24 * time.Hour) })
	if _, err := noteSvc.PermanentlyDeleteExpiredTrash(ctx, userID, nil); err != nil {
		t.Fatalf("permanently delete trash: %v", err)
	}

	pull, err := svc.Pull(ctx, userID, Cursor{}, 20)
	if err != nil {
		t.Fatalf("Pull() error = %v", err)
	}

	seen := make(map[uuid.UUID]string)
	for _, item := range pull.Items {
		seen[item.NoteID] = item.Tombstone
	}

	if got := seen[active.ID]; got != "" {
		t.Fatalf("active note tombstone = %q, want empty", got)
	}
	if got := seen[trash.ID]; got != "trash" {
		t.Fatalf("trash note tombstone = %q, want %q", got, "trash")
	}
	if got := seen[purged.ID]; got != "permanent" {
		t.Fatalf("purged note tombstone = %q, want %q", got, "permanent")
	}
}

func insertTestUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()

	userID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, userID.String()+"@example.com", "hash", "sync-user")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return userID
}

func insertTestSession(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID uuid.UUID) uuid.UUID {
	t.Helper()

	sessionID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO user_sessions (id, user_id, device_code, device_name, refresh_token_hash)
		VALUES ($1, $2, $3, $4, $5)
	`, sessionID, userID, "ios", "iPhone", "hash")
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}
	return sessionID
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
