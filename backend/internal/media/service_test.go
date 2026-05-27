package media

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/platform/testutil"
)

func TestValidateUploadAllowsImagesAndRejectsInvalidTypesAndLargeFiles(t *testing.T) {
	svc := NewService(nil, t.TempDir())

	for _, mimeType := range []string{"image/jpeg", "image/png", "image/webp", "image/gif"} {
		if err := svc.ValidateUpload(mimeType, 1024); err != nil {
			t.Fatalf("ValidateUpload(%s) error = %v", mimeType, err)
		}
	}

	if err := svc.ValidateUpload("text/html", 1024); err != ErrInvalidMIMEType {
		t.Fatalf("ValidateUpload(text/html) error = %v, want %v", err, ErrInvalidMIMEType)
	}
	if err := svc.ValidateUpload("application/octet-stream", 1024); err != ErrInvalidMIMEType {
		t.Fatalf("ValidateUpload(unknown) error = %v, want %v", err, ErrInvalidMIMEType)
	}
	if err := svc.ValidateUpload("image/png", 0); err != ErrInvalidSize {
		t.Fatalf("ValidateUpload(zero size) error = %v, want %v", err, ErrInvalidSize)
	}
	if err := svc.ValidateUpload("image/png", DefaultMaxSizeBytes+1); err != ErrFileTooLarge {
		t.Fatalf("ValidateUpload(too large) error = %v, want %v", err, ErrFileTooLarge)
	}
}

func TestUploadRejectsChecksumMismatchBeforeWritingFinalFile(t *testing.T) {
	svc := NewService(nil, t.TempDir())
	body := []byte("fake png bytes")

	_, err := svc.Upload(context.Background(), UploadInput{
		UserID:    uuid.New(),
		Kind:      "image",
		MIMEType:  "image/png",
		SizeBytes: int64(len(body)),
		Checksum:  "not-the-real-checksum",
		Reader:    bytes.NewReader(body),
	})
	if err != ErrChecksumMismatch {
		t.Fatalf("Upload() error = %v, want %v", err, ErrChecksumMismatch)
	}
}

func TestUploadStoresAssetMetadataAndFile(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	root := t.TempDir()
	svc := NewService(db, root)

	body := []byte("fake png bytes")
	asset, err := svc.Upload(ctx, UploadInput{
		UserID:    userID,
		Kind:      "image",
		MIMEType:  "image/png",
		SizeBytes: int64(len(body)),
		Reader:    bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("Upload() error = %v", err)
	}

	if asset.UserID != userID || asset.MIMEType != "image/png" || asset.SizeBytes != int64(len(body)) {
		t.Fatalf("unexpected asset: %#v", asset)
	}
	path := filepath.Join(root, filepath.FromSlash(asset.StorageKey))
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read stored file: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("stored file = %q, want %q", got, body)
	}
}

func TestMarkUnreferencedDoesNotMarkAvatarMedia(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	root := t.TempDir()
	svc := NewService(db, root)
	fixedNow := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	svc.SetNowForTest(func() time.Time { return fixedNow })

	body := []byte("avatar image")
	asset, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)})
	if err != nil {
		t.Fatalf("Upload() error = %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE users SET avatar_media_id = $2 WHERE id = $1`, userID, asset.ID); err != nil {
		t.Fatalf("set avatar: %v", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	if err := svc.MarkUnreferencedAssetsForDeletion(ctx, tx, userID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("MarkUnreferencedAssetsForDeletion() error = %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var deletedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at FROM media_assets WHERE user_id = $1 AND id = $2`, userID, asset.ID).Scan(&deletedAt); err != nil {
		t.Fatalf("query avatar media: %v", err)
	}
	if deletedAt != nil {
		t.Fatalf("avatar media deleted_at = %v, want nil", deletedAt)
	}
}

func TestMarkUnreferencedAndPurgeDueAssets(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	root := t.TempDir()
	svc := NewService(db, root)
	fixedNow := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	svc.SetNowForTest(func() time.Time { return fixedNow })

	body := []byte("orphan image")
	asset, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)})
	if err != nil {
		t.Fatalf("Upload() error = %v", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	if err := svc.MarkUnreferencedAssetsForDeletion(ctx, tx, userID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("MarkUnreferencedAssetsForDeletion() error = %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var deletedAt, purgeAfter *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at, purge_after FROM media_assets WHERE user_id = $1 AND id = $2`, userID, asset.ID).Scan(&deletedAt, &purgeAfter); err != nil {
		t.Fatalf("query marked media: %v", err)
	}
	if deletedAt == nil || !deletedAt.Equal(fixedNow) {
		t.Fatalf("deleted_at = %v, want %v", deletedAt, fixedNow)
	}
	if purgeAfter == nil || !purgeAfter.Equal(fixedNow) {
		t.Fatalf("purge_after = %v, want %v", purgeAfter, fixedNow)
	}

	if err := svc.PurgeDueAssets(ctx, fixedNow); err != nil {
		t.Fatalf("PurgeDueAssets() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(asset.StorageKey))); !os.IsNotExist(err) {
		t.Fatalf("stored file should be removed, stat err = %v", err)
	}
	var purgedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT purged_at FROM media_assets WHERE user_id = $1 AND id = $2`, userID, asset.ID).Scan(&purgedAt); err != nil {
		t.Fatalf("query purged media: %v", err)
	}
	if purgedAt == nil || !purgedAt.Equal(fixedNow) {
		t.Fatalf("purged_at = %v, want %v", purgedAt, fixedNow)
	}
}

func resetSchemaAndMigrate(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	dropSQL := "DROP TABLE IF EXISTS sync_operations, note_tags, tags, note_media_refs, media_assets, notes, user_sessions, users CASCADE;"
	if _, err := db.Exec(ctx, dropSQL); err != nil {
		t.Fatalf("drop existing tables: %v", err)
	}
	t.Cleanup(func() { _, _ = db.Exec(ctx, dropSQL) })
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

func insertTestUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()
	userID := uuid.New()
	_, err := db.Exec(ctx, `INSERT INTO users (id, email, password_hash, username) VALUES ($1, $2, $3, $4)`, userID, userID.String()+"@example.com", "hash", "media-user")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return userID
}
