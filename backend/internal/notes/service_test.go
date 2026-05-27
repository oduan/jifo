package notes

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/platform/testutil"
	"jifo/backend/internal/tags"
)

func TestCreateCreatesTagsNoteTagsAndCounts(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	note, err := svc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-create-1",
		Content:   textContent("#思考 #电视剧/电视剧1"),
		PlainText: "#思考 #电视剧/电视剧1 这个电视剧真的很好看",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if note.UserID != userID {
		t.Fatalf("note user_id = %s, want %s", note.UserID, userID)
	}
	if note.ClientID != "note-create-1" {
		t.Fatalf("note client_id = %q, want %q", note.ClientID, "note-create-1")
	}
	if note.Version != 1 {
		t.Fatalf("note version = %d, want 1", note.Version)
	}
	if note.DeletedAt != nil {
		t.Fatalf("note deleted_at = %v, want nil", note.DeletedAt)
	}
	if note.PurgeAfter != nil {
		t.Fatalf("note purge_after = %v, want nil", note.PurgeAfter)
	}

	assertTagCount(t, ctx, db, userID, "思考", 1)
	assertTagCount(t, ctx, db, userID, "电视剧", 1)
	assertTagCount(t, ctx, db, userID, "电视剧/电视剧1", 1)
	assertNoteTagCount(t, ctx, db, userID, note.ID, 3)
}

func TestUpdateRebuildsTagsRecountsAndBumpsVersion(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	created, err := svc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-update-1",
		Content:   textContent("#A"),
		PlainText: "#A",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	updated, err := svc.Update(ctx, UpdateInput{
		UserID:    userID,
		NoteID:    created.ID,
		Content:   textContent("#B/子"),
		PlainText: "#B/子",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if updated.Version != created.Version+1 {
		t.Fatalf("updated version = %d, want %d", updated.Version, created.Version+1)
	}

	assertTagCount(t, ctx, db, userID, "A", 0)
	assertTagCount(t, ctx, db, userID, "B", 1)
	assertTagCount(t, ctx, db, userID, "B/子", 1)
	assertNoteTagCount(t, ctx, db, userID, created.ID, 2)
}

func TestMoveToTrashDeletesNoteTagsRecountsAndListsTrash(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	created, err := svc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-trash-1",
		Content:   textContent("#思考 #电视剧/电视剧1"),
		PlainText: "#思考 #电视剧/电视剧1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	fixedNow := time.Date(2026, 5, 27, 4, 0, 0, 0, time.UTC)
	svc.SetNowForTest(func() time.Time { return fixedNow })

	trashed, err := svc.MoveToTrash(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("MoveToTrash() error = %v", err)
	}

	if trashed.Version != created.Version+1 {
		t.Fatalf("trashed version = %d, want %d", trashed.Version, created.Version+1)
	}
	if trashed.DeletedAt == nil || !trashed.DeletedAt.Equal(fixedNow) {
		t.Fatalf("deleted_at = %v, want %v", trashed.DeletedAt, fixedNow)
	}
	wantPurgeAfter := fixedNow.Add(30 * 24 * time.Hour)
	if trashed.PurgeAfter == nil || !trashed.PurgeAfter.Equal(wantPurgeAfter) {
		t.Fatalf("purge_after = %v, want %v", trashed.PurgeAfter, wantPurgeAfter)
	}

	assertNoteTagCount(t, ctx, db, userID, created.ID, 0)
	assertTagCount(t, ctx, db, userID, "思考", 0)
	assertTagCount(t, ctx, db, userID, "电视剧", 0)
	assertTagCount(t, ctx, db, userID, "电视剧/电视剧1", 0)

	activeNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: false})
	if err != nil {
		t.Fatalf("List(active) error = %v", err)
	}
	if len(activeNotes) != 0 {
		t.Fatalf("active notes len = %d, want 0", len(activeNotes))
	}

	trashNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: true})
	if err != nil {
		t.Fatalf("List(trash) error = %v", err)
	}
	if len(trashNotes) != 1 {
		t.Fatalf("trash notes len = %d, want 1", len(trashNotes))
	}
	if trashNotes[0].ID != created.ID {
		t.Fatalf("trash note id = %s, want %s", trashNotes[0].ID, created.ID)
	}
}

func TestRestoreRebuildsNoteTagsRecountsAndBumpsVersion(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	created, err := svc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-restore-1",
		Content:   textContent("#恢复/子"),
		PlainText: "#恢复/子",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	svc.SetNowForTest(func() time.Time {
		return time.Date(2026, 5, 27, 4, 0, 0, 0, time.UTC)
	})
	trashed, err := svc.MoveToTrash(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("MoveToTrash() error = %v", err)
	}

	restoreNow := time.Date(2026, 6, 1, 9, 30, 0, 0, time.UTC)
	svc.SetNowForTest(func() time.Time { return restoreNow })

	restored, err := svc.Restore(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("Restore() error = %v", err)
	}

	if restored.Version != trashed.Version+1 {
		t.Fatalf("restored version = %d, want %d", restored.Version, trashed.Version+1)
	}
	if restored.DeletedAt != nil {
		t.Fatalf("deleted_at = %v, want nil", restored.DeletedAt)
	}
	if restored.PurgeAfter != nil {
		t.Fatalf("purge_after = %v, want nil", restored.PurgeAfter)
	}
	if !restored.UpdatedAt.Equal(restoreNow) {
		t.Fatalf("updated_at = %v, want %v", restored.UpdatedAt, restoreNow)
	}

	assertNoteTagCount(t, ctx, db, userID, created.ID, 2)
	assertTagCount(t, ctx, db, userID, "恢复", 1)
	assertTagCount(t, ctx, db, userID, "恢复/子", 1)

	activeNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: false})
	if err != nil {
		t.Fatalf("List(active) error = %v", err)
	}
	if len(activeNotes) != 1 || activeNotes[0].ID != created.ID {
		t.Fatalf("active notes = %#v, want note %s", activeNotes, created.ID)
	}

	trashNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: true})
	if err != nil {
		t.Fatalf("List(trash) error = %v", err)
	}
	if len(trashNotes) != 0 {
		t.Fatalf("trash notes len = %d, want 0", len(trashNotes))
	}
}

func TestCreateAndUpdateMaintainMediaRefs(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	firstMediaID := insertTestMedia(t, ctx, db, userID, "first")
	secondMediaID := insertTestMedia(t, ctx, db, userID, "second")

	svc := NewService(db, tags.NewService(db))
	created, err := svc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-media-1",
		Content:   Content{Blocks: []Block{{Type: "paragraph", Text: "hello"}, {Type: "image", MediaID: &firstMediaID}}},
		PlainText: "hello",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	assertNoteMediaRefCount(t, ctx, db, userID, created.ID, firstMediaID, 1)

	_, err = svc.Update(ctx, UpdateInput{
		UserID:    userID,
		NoteID:    created.ID,
		Content:   Content{Blocks: []Block{{Type: "image", MediaID: &secondMediaID}}},
		PlainText: "updated",
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	assertNoteMediaRefCount(t, ctx, db, userID, created.ID, firstMediaID, 0)
	assertNoteMediaRefCount(t, ctx, db, userID, created.ID, secondMediaID, 1)
}

func TestMutationsRejectMissingOrCrossUserNotes(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	ownerID := insertTestUser(t, ctx, db)
	otherID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	created, err := svc.Create(ctx, CreateInput{
		UserID:    ownerID,
		ClientID:  "note-negative-1",
		Content:   textContent("#私有"),
		PlainText: "#私有",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := svc.Update(ctx, UpdateInput{UserID: otherID, NoteID: created.ID, Content: textContent("#越权"), PlainText: "#越权"}); err != ErrNoteNotFound {
		t.Fatalf("cross-user Update() error = %v, want %v", err, ErrNoteNotFound)
	}
	if _, err := svc.MoveToTrash(ctx, otherID, created.ID); err != ErrNoteNotFound {
		t.Fatalf("cross-user MoveToTrash() error = %v, want %v", err, ErrNoteNotFound)
	}
	if _, err := svc.Restore(ctx, ownerID, uuid.New()); err != ErrNoteNotFound {
		t.Fatalf("missing Restore() error = %v, want %v", err, ErrNoteNotFound)
	}

	assertTagCount(t, ctx, db, ownerID, "私有", 1)
	assertNoteTagCount(t, ctx, db, ownerID, created.ID, 1)
}

func TestCreateDeduplicatesRepeatedTags(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	created, err := svc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-dedup-1",
		Content:   textContent("#重复 #重复 #重复/子 #重复/子"),
		PlainText: "#重复 #重复 #重复/子 #重复/子",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	assertTagCount(t, ctx, db, userID, "重复", 1)
	assertTagCount(t, ctx, db, userID, "重复/子", 1)
	assertNoteTagCount(t, ctx, db, userID, created.ID, 2)
}

func assertTagCount(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID uuid.UUID, path string, want int) {
	t.Helper()

	var got int
	if err := db.QueryRow(ctx, `SELECT note_count FROM tags WHERE user_id = $1 AND path = $2`, userID, path).Scan(&got); err != nil {
		t.Fatalf("query tag %q: %v", path, err)
	}
	if got != want {
		t.Fatalf("tag %q note_count = %d, want %d", path, got, want)
	}
}

func assertNoteMediaRefCount(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID uuid.UUID, noteID uuid.UUID, mediaID uuid.UUID, want int) {
	t.Helper()

	var got int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM note_media_refs WHERE user_id = $1 AND note_id = $2 AND media_id = $3`, userID, noteID, mediaID).Scan(&got); err != nil {
		t.Fatalf("count note_media_refs: %v", err)
	}
	if got != want {
		t.Fatalf("note_media_refs count = %d, want %d", got, want)
	}
}

func assertNoteTagCount(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID uuid.UUID, noteID uuid.UUID, want int) {
	t.Helper()

	var got int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM note_tags WHERE user_id = $1 AND note_id = $2`, userID, noteID).Scan(&got); err != nil {
		t.Fatalf("count note_tags: %v", err)
	}
	if got != want {
		t.Fatalf("note_tags count = %d, want %d", got, want)
	}
}

func insertTestMedia(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID uuid.UUID, key string) uuid.UUID {
	t.Helper()

	mediaID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO media_assets (id, user_id, kind, mime_type, size_bytes, storage_key, checksum)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, mediaID, userID, "image", "image/png", 10, key, "checksum-"+key)
	if err != nil {
		t.Fatalf("insert media: %v", err)
	}
	return mediaID
}

func insertTestUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()

	userID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, userID.String()+"@example.com", "hash", "notes-user")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return userID
}

func textContent(text string) Content {
	return Content{Blocks: []Block{{Type: "paragraph", Text: text}}}
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
