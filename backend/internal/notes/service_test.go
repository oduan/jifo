package notes

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/media"
	"jifo/backend/internal/platform/testutil"
	"jifo/backend/internal/tags"
)

func TestServiceListReturnsHasMoreWhenLimitHasExtraRow(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	for i := 0; i < 3; i++ {
		_, err := svc.Create(ctx, CreateInput{
			UserID:    userID,
			ClientID:  fmt.Sprintf("client-%d", i),
			Content:   Content{Blocks: []Block{{Type: "paragraph", Text: fmt.Sprintf("note %d", i)}}},
			PlainText: fmt.Sprintf("note %d", i),
		})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
	}

	result, err := svc.List(ctx, ListFilter{UserID: userID, Limit: 2, Offset: 0})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("items len = %d, want 2", len(result.Items))
	}
	if !result.HasMore {
		t.Fatalf("HasMore = false, want true")
	}

	lastPage, err := svc.List(ctx, ListFilter{UserID: userID, Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("List() last page error = %v", err)
	}
	if len(lastPage.Items) != 1 {
		t.Fatalf("last page len = %d, want 1", len(lastPage.Items))
	}
	if lastPage.HasMore {
		t.Fatalf("last page HasMore = true, want false")
	}
}

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
	if len(activeNotes.Items) != 0 {
		t.Fatalf("active notes len = %d, want 0", len(activeNotes.Items))
	}

	trashNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: true})
	if err != nil {
		t.Fatalf("List(trash) error = %v", err)
	}
	if len(trashNotes.Items) != 1 {
		t.Fatalf("trash notes len = %d, want 1", len(trashNotes.Items))
	}
	if trashNotes.Items[0].ID != created.ID {
		t.Fatalf("trash note id = %s, want %s", trashNotes.Items[0].ID, created.ID)
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
	if len(activeNotes.Items) != 1 || activeNotes.Items[0].ID != created.ID {
		t.Fatalf("active notes = %#v, want note %s", activeNotes, created.ID)
	}

	trashNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: true})
	if err != nil {
		t.Fatalf("List(trash) error = %v", err)
	}
	if len(trashNotes.Items) != 0 {
		t.Fatalf("trash notes len = %d, want 0", len(trashNotes.Items))
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
		Content:   Content{Blocks: []Block{{Type: "paragraph", Text: "hello"}, {Type: "image", MediaID: &firstMediaID}, {Type: "image", MediaID: &firstMediaID}}},
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

func TestCreateRejectsCrossUserMediaRef(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	ownerID := insertTestUser(t, ctx, db)
	otherID := insertTestUser(t, ctx, db)
	otherMediaID := insertTestMedia(t, ctx, db, otherID, "other-media")

	svc := NewService(db, tags.NewService(db))
	_, err := svc.Create(ctx, CreateInput{
		UserID:    ownerID,
		ClientID:  "note-cross-media-1",
		Content:   Content{Blocks: []Block{{Type: "image", MediaID: &otherMediaID}}},
		PlainText: "cross media",
	})
	if err == nil {
		t.Fatal("Create() with cross-user media error = nil, want error")
	}
	var refs int
	if countErr := db.QueryRow(ctx, `SELECT COUNT(*) FROM note_media_refs WHERE user_id = $1`, ownerID).Scan(&refs); countErr != nil {
		t.Fatalf("count note_media_refs: %v", countErr)
	}
	if refs != 0 {
		t.Fatalf("owner note_media_refs = %d, want 0", refs)
	}
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

func TestPermanentlyDeleteExpiredTrashRemovesMediaRefsAndMarksUnreferencedMedia(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	mediaID := insertTestMedia(t, ctx, db, userID, "expired-media")

	tagSvc := tags.NewService(db)
	noteSvc := NewService(db, tagSvc)
	mediaSvc := media.NewService(db, t.TempDir())

	created, err := noteSvc.Create(ctx, CreateInput{
		UserID:    userID,
		ClientID:  "note-permanent-1",
		Content:   Content{Blocks: []Block{{Type: "image", MediaID: &mediaID}}},
		PlainText: "#过期",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	trashTime := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	noteSvc.SetNowForTest(func() time.Time { return trashTime })
	if _, err := noteSvc.MoveToTrash(ctx, userID, created.ID); err != nil {
		t.Fatalf("MoveToTrash() error = %v", err)
	}

	permanentTime := trashTime.Add(31 * 24 * time.Hour)
	noteSvc.SetNowForTest(func() time.Time { return permanentTime })
	mediaSvc.SetNowForTest(func() time.Time { return permanentTime })
	count, err := noteSvc.PermanentlyDeleteExpiredTrash(ctx, userID, mediaSvc)
	if err != nil {
		t.Fatalf("PermanentlyDeleteExpiredTrash() error = %v", err)
	}
	if count != 1 {
		t.Fatalf("permanently deleted count = %d, want 1", count)
	}

	var permanentlyDeletedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT permanently_deleted_at FROM notes WHERE user_id = $1 AND id = $2`, userID, created.ID).Scan(&permanentlyDeletedAt); err != nil {
		t.Fatalf("query note permanently_deleted_at: %v", err)
	}
	if permanentlyDeletedAt == nil || !permanentlyDeletedAt.Equal(permanentTime) {
		t.Fatalf("permanently_deleted_at = %v, want %v", permanentlyDeletedAt, permanentTime)
	}
	assertNoteMediaRefCount(t, ctx, db, userID, created.ID, mediaID, 0)

	var mediaDeletedAt, mediaPurgeAfter *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at, purge_after FROM media_assets WHERE user_id = $1 AND id = $2`, userID, mediaID).Scan(&mediaDeletedAt, &mediaPurgeAfter); err != nil {
		t.Fatalf("query media deletion fields: %v", err)
	}
	if mediaDeletedAt == nil || !mediaDeletedAt.Equal(permanentTime) {
		t.Fatalf("media deleted_at = %v, want %v", mediaDeletedAt, permanentTime)
	}
	if mediaPurgeAfter == nil || !mediaPurgeAfter.Equal(permanentTime) {
		t.Fatalf("media purge_after = %v, want %v", mediaPurgeAfter, permanentTime)
	}

	trashNotes, err := noteSvc.List(ctx, ListFilter{UserID: userID, Trash: true})
	if err != nil {
		t.Fatalf("List(trash) error = %v", err)
	}
	if len(trashNotes.Items) != 0 {
		t.Fatalf("trash notes len = %d, want 0 after permanent deletion", len(trashNotes.Items))
	}
}

func TestListSupportsPaginationSearchTagPathAndTrash(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db, tags.NewService(db))
	noteA, err := svc.Create(ctx, CreateInput{UserID: userID, ClientID: "list-a", Content: textContent("#项目/后端 alpha"), PlainText: "#项目/后端 alpha"})
	if err != nil {
		t.Fatalf("Create(noteA) error = %v", err)
	}
	noteB, err := svc.Create(ctx, CreateInput{UserID: userID, ClientID: "list-b", Content: textContent("#项目 beta"), PlainText: "#项目 beta"})
	if err != nil {
		t.Fatalf("Create(noteB) error = %v", err)
	}
	noteTrash, err := svc.Create(ctx, CreateInput{UserID: userID, ClientID: "list-trash", Content: textContent("#项目/前端 trash me"), PlainText: "#项目/前端 trash me"})
	if err != nil {
		t.Fatalf("Create(noteTrash) error = %v", err)
	}
	notePermanent, err := svc.Create(ctx, CreateInput{UserID: userID, ClientID: "list-permanent", Content: textContent("#生活 permanent"), PlainText: "#生活 permanent"})
	if err != nil {
		t.Fatalf("Create(notePermanent) error = %v", err)
	}

	if _, err := db.Exec(ctx, `UPDATE notes SET created_at = $3, updated_at = $3 WHERE user_id = $1 AND id = $2`, userID, noteA.ID, time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("set noteA timestamps: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE notes SET created_at = $3, updated_at = $3 WHERE user_id = $1 AND id = $2`, userID, noteB.ID, time.Date(2026, 5, 1, 11, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("set noteB timestamps: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE notes SET created_at = $3, updated_at = $3 WHERE user_id = $1 AND id = $2`, userID, noteTrash.ID, time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("set noteTrash timestamps: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE notes SET created_at = $3, updated_at = $3 WHERE user_id = $1 AND id = $2`, userID, notePermanent.ID, time.Date(2026, 5, 1, 13, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("set notePermanent timestamps: %v", err)
	}

	if _, err := svc.MoveToTrash(ctx, userID, noteTrash.ID); err != nil {
		t.Fatalf("MoveToTrash() error = %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE notes SET permanently_deleted_at = now() WHERE user_id = $1 AND id = $2`, userID, notePermanent.ID); err != nil {
		t.Fatalf("set permanently_deleted_at: %v", err)
	}

	searchNotes, err := svc.List(ctx, ListFilter{UserID: userID, Search: "alpha"})
	if err != nil {
		t.Fatalf("List(search) error = %v", err)
	}
	if len(searchNotes.Items) != 1 || searchNotes.Items[0].ID != noteA.ID {
		t.Fatalf("search notes = %#v, want only noteA", searchNotes)
	}

	tagNotes, err := svc.List(ctx, ListFilter{UserID: userID, TagPath: "项目"})
	if err != nil {
		t.Fatalf("List(tag parent) error = %v", err)
	}
	if len(tagNotes.Items) != 2 || tagNotes.Items[0].ID != noteB.ID || tagNotes.Items[1].ID != noteA.ID {
		t.Fatalf("tag notes = %#v, want [noteB, noteA]", tagNotes)
	}

	pageNotes, err := svc.List(ctx, ListFilter{UserID: userID, TagPath: "项目", Limit: 1, Offset: 1})
	if err != nil {
		t.Fatalf("List(pagination) error = %v", err)
	}
	if len(pageNotes.Items) != 1 || pageNotes.Items[0].ID != noteA.ID {
		t.Fatalf("page notes = %#v, want [noteA]", pageNotes)
	}

	trashNotes, err := svc.List(ctx, ListFilter{UserID: userID, Trash: true})
	if err != nil {
		t.Fatalf("List(trash) error = %v", err)
	}
	if len(trashNotes.Items) != 1 || trashNotes.Items[0].ID != noteTrash.ID {
		t.Fatalf("trash notes = %#v, want only noteTrash", trashNotes)
	}
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
