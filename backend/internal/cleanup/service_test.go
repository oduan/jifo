package cleanup

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/media"
	platformdb "jifo/backend/internal/platform/db"
	"jifo/backend/internal/platform/testutil"
)

func TestRunOncePermanentlyDeletesDueTrashAndPurgesOldOrphanMedia(t *testing.T) {
	pool := testutil.OpenTestDB(t)
	ctx := context.Background()
	if err := platformdb.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations() error = %v", err)
	}

	userID := uuid.New()
	noteID := uuid.New()
	mediaID := uuid.New()
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, password_hash, username) VALUES ($1, $2, 'hash', 'cleanup')`, userID, userID.String()+"@example.com"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID) })
	if _, err := pool.Exec(ctx, `
		INSERT INTO notes (id, user_id, client_id, content, plain_text, deleted_at, purge_after)
		VALUES ($1, $2, 'cleanup-note', '{"blocks":[]}', '', $3, $3)
	`, noteID, userID, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO media_assets (id, user_id, kind, mime_type, size_bytes, storage_key, checksum, created_at)
		VALUES ($1, $2, 'image', 'image/png', 1, $3, 'checksum', $4)
	`, mediaID, userID, userID.String()+"/"+mediaID.String(), now.Add(-25*time.Hour)); err != nil {
		t.Fatal(err)
	}

	service := NewService(pool, media.NewService(pool, t.TempDir()), nil)
	count, ran, err := service.RunOnce(ctx, now)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !ran || count != 1 {
		t.Fatalf("RunOnce() = count %d, ran %v; want 1, true", count, ran)
	}

	var permanentlyDeletedAt, purgedAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT permanently_deleted_at FROM notes WHERE id = $1`, noteID).Scan(&permanentlyDeletedAt); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT purged_at FROM media_assets WHERE id = $1`, mediaID).Scan(&purgedAt); err != nil {
		t.Fatal(err)
	}
	if permanentlyDeletedAt == nil || purgedAt == nil {
		t.Fatalf("permanentlyDeletedAt=%v purgedAt=%v", permanentlyDeletedAt, purgedAt)
	}
}
