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

func TestUploadEnforcesPerUserQuota(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	svc := NewService(db, t.TempDir())
	svc.SetUserQuotaBytes(100)

	upload := func(size int64) error {
		_, err := svc.Upload(ctx, UploadInput{
			UserID:    userID,
			Kind:      "image",
			MIMEType:  "image/png",
			SizeBytes: size,
			Reader:    bytes.NewReader(make([]byte, size)),
		})
		return err
	}

	// 60 字节放行；再传 41 字节超限（60+41 > 100）拒绝；边界 40 字节（60+40 == 100）放行。
	if err := upload(60); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	if err := upload(41); err != ErrQuotaExceeded {
		t.Fatalf("over-quota upload error = %v, want %v", err, ErrQuotaExceeded)
	}
	if err := upload(40); err != nil {
		t.Fatalf("boundary upload at exactly quota: %v", err)
	}
	// 配额已满：哪怕 1 字节也应拒绝。
	if err := upload(1); err != ErrQuotaExceeded {
		t.Fatalf("full-quota upload error = %v, want %v", err, ErrQuotaExceeded)
	}
}

func TestUploadQuotaCountsSoftDeletedAssets(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	svc := NewService(db, t.TempDir())
	svc.SetUserQuotaBytes(40)

	body := []byte("deleted but still on disk")
	asset, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)})
	if err != nil {
		t.Fatalf("seed upload: %v", err)
	}
	// 标记删除（宽限期内，文件仍在）：统计应继续计入配额。
	if _, err := db.Exec(ctx, `UPDATE media_assets SET deleted_at = now(), purge_after = now() + interval '7 days' WHERE user_id = $1 AND id = $2`, userID, asset.ID); err != nil {
		t.Fatalf("mark deleted: %v", err)
	}
	if _, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)}); err != ErrQuotaExceeded {
		t.Fatalf("upload after soft delete error = %v, want %v", err, ErrQuotaExceeded)
	}
}

func TestUploadAllowsUnlimitedQuotaWhenDisabled(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	svc := NewService(db, t.TempDir())

	body := []byte("quota disabled")
	// 对照：配额 20 时第二次上传(累计 14+14=28 字节)应被拒;首次 14 字节放行。
	// (原写作 50,14+14=28 并不超过 50,该分支在真实库上永远走不到拒绝路径。)
	svc.SetUserQuotaBytes(20)
	if _, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)}); err != nil {
		t.Fatalf("seed upload: %v", err)
	}
	if _, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)}); err != ErrQuotaExceeded {
		t.Fatalf("second upload under quota 20 error = %v, want %v", err, ErrQuotaExceeded)
	}
	// 0 = 不限制：同样的上传立刻放行，多次累计也放行。
	svc.SetUserQuotaBytes(0)
	for i := 0; i < 3; i++ {
		if _, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)}); err != nil {
			t.Fatalf("upload %d with quota disabled: %v", i+1, err)
		}
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
	if deletedAt == nil {
		t.Fatal("deleted_at should be set")
	}
	// 宽限期：purge_after 应在 deleted_at 之后约 7 天。
	if purgeAfter == nil || purgeAfter.Sub(*deletedAt) < 6*24*time.Hour {
		t.Fatalf("purge_after = %v, want ~7 days after deleted_at %v", purgeAfter, deletedAt)
	}

	// 宽限期未到：不应被清理。
	if err := svc.PurgeDueAssets(ctx, time.Now()); err != nil {
		t.Fatalf("PurgeDueAssets() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(asset.StorageKey))); err != nil {
		t.Fatalf("stored file should survive grace period, stat err = %v", err)
	}

	// 模拟宽限期到期后清理。
	if _, err := db.Exec(ctx, `UPDATE media_assets SET purge_after = now() - interval '1 hour' WHERE user_id = $1 AND id = $2`, userID, asset.ID); err != nil {
		t.Fatalf("backdate purge_after: %v", err)
	}
	purgeNow := time.Now()
	if err := svc.PurgeDueAssets(ctx, purgeNow); err != nil {
		t.Fatalf("PurgeDueAssets() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(asset.StorageKey))); !os.IsNotExist(err) {
		t.Fatalf("stored file should be removed, stat err = %v", err)
	}
	var purgedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT purged_at FROM media_assets WHERE user_id = $1 AND id = $2`, userID, asset.ID).Scan(&purgedAt); err != nil {
		t.Fatalf("query purged media: %v", err)
	}
	if purgedAt == nil {
		t.Fatal("purged_at should be set")
	}
}

func TestPurgeDueAssetsRestoresReReferencedAsset(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)
	root := t.TempDir()
	svc := NewService(db, root)

	body := []byte("re-referenced image")
	asset, err := svc.Upload(ctx, UploadInput{UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: int64(len(body)), Reader: bytes.NewReader(body)})
	if err != nil {
		t.Fatalf("Upload() error = %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE media_assets SET deleted_at = now(), purge_after = now() - interval '1 hour' WHERE user_id = $1 AND id = $2`, userID, asset.ID); err != nil {
		t.Fatalf("mark for deletion: %v", err)
	}

	// 宽限期内被笔记重新引用。
	noteID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO notes (id, user_id, client_id, content, plain_text) VALUES ($1, $2, $3, '{"blocks":[]}', '')`, noteID, userID, "c-reref"); err != nil {
		t.Fatalf("insert note: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO note_media_refs (user_id, note_id, media_id) VALUES ($1, $2, $3)`, userID, noteID, asset.ID); err != nil {
		t.Fatalf("insert media ref: %v", err)
	}

	if err := svc.PurgeDueAssets(ctx, time.Now()); err != nil {
		t.Fatalf("PurgeDueAssets() error = %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(asset.StorageKey))); err != nil {
		t.Fatalf("referenced file must not be removed, stat err = %v", err)
	}
	var deletedAt, purgeAfter, purgedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at, purge_after, purged_at FROM media_assets WHERE user_id = $1 AND id = $2`, userID, asset.ID).Scan(&deletedAt, &purgeAfter, &purgedAt); err != nil {
		t.Fatalf("query asset: %v", err)
	}
	if deletedAt != nil || purgeAfter != nil || purgedAt != nil {
		t.Fatalf("asset should be restored, got deleted_at=%v purge_after=%v purged_at=%v", deletedAt, purgeAfter, purgedAt)
	}
}

func resetSchemaAndMigrate(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	testutil.ResetDatabase(t, ctx, db)
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
