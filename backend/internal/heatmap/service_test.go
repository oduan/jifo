package heatmap

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
)

func TestMergeDailyCountsIncludesCreatedAndUpdatedTotals(t *testing.T) {
	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 3, 0, 0, 0, 0, time.UTC)

	created := map[time.Time]int64{
		from:                  2,
		from.AddDate(0, 0, 1): 1,
	}
	updated := map[time.Time]int64{
		from:                  1,
		from.AddDate(0, 0, 1): 1,
		from.AddDate(0, 0, 2): 1,
	}

	days := mergeDailyCounts(from, to, created, updated)
	if len(days) != 3 {
		t.Fatalf("days len = %d, want 3", len(days))
	}
	if days[0].CreatedCount != 2 || days[0].UpdatedCount != 1 || days[0].TotalCount != 3 {
		t.Fatalf("day1 = %#v, want created=2 updated=1 total=3", days[0])
	}
	if days[1].CreatedCount != 1 || days[1].UpdatedCount != 1 || days[1].TotalCount != 2 {
		t.Fatalf("day2 = %#v, want created=1 updated=1 total=2", days[1])
	}
	if days[2].CreatedCount != 0 || days[2].UpdatedCount != 1 || days[2].TotalCount != 1 {
		t.Fatalf("day3 = %#v, want created=0 updated=1 total=1", days[2])
	}
}

func TestAggregateExcludesPermanentlyDeletedNotes(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertHeatmapUser(t, ctx, db)

	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 3, 0, 0, 0, 0, time.UTC)

	insertHeatmapNote(t, ctx, db, userID, "n1", from.Add(9*time.Hour), from.Add(9*time.Hour), nil)
	insertHeatmapNote(t, ctx, db, userID, "n2", from.Add(10*time.Hour), from.AddDate(0, 0, 1).Add(10*time.Hour), nil)
	insertHeatmapNote(t, ctx, db, userID, "n3", from.AddDate(0, 0, 1).Add(11*time.Hour), from.AddDate(0, 0, 2).Add(11*time.Hour), nil)
	permanentAt := from.AddDate(0, 0, 2).Add(12 * time.Hour)
	insertHeatmapNote(t, ctx, db, userID, "n4", from.AddDate(0, 0, 1).Add(12*time.Hour), from.AddDate(0, 0, 1).Add(12*time.Hour), &permanentAt)

	svc := NewService(db)
	result, err := svc.Aggregate(ctx, userID, from, to)
	if err != nil {
		t.Fatalf("Aggregate() error = %v", err)
	}
	if len(result) != 3 {
		t.Fatalf("result len = %d, want 3", len(result))
	}
	if result[0].CreatedCount != 2 || result[0].UpdatedCount != 1 || result[0].TotalCount != 3 {
		t.Fatalf("day1 = %#v", result[0])
	}
	if result[1].CreatedCount != 1 || result[1].UpdatedCount != 1 || result[1].TotalCount != 2 {
		t.Fatalf("day2 = %#v", result[1])
	}
	if result[2].CreatedCount != 0 || result[2].UpdatedCount != 1 || result[2].TotalCount != 1 {
		t.Fatalf("day3 = %#v", result[2])
	}
}

func insertHeatmapUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()
	userID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, userID.String()+"@example.com", "hash", "heatmap-user")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return userID
}

func insertHeatmapNote(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID uuid.UUID, clientID string, createdAt time.Time, updatedAt time.Time, permanentlyDeletedAt *time.Time) {
	t.Helper()
	_, err := db.Exec(ctx, `
		INSERT INTO notes (user_id, client_id, content, plain_text, created_at, updated_at, permanently_deleted_at)
		VALUES ($1, $2, '{}'::jsonb, $3, $4, $5, $6)
	`, userID, clientID, clientID, createdAt, updatedAt, permanentlyDeletedAt)
	if err != nil {
		t.Fatalf("insert note %q: %v", clientID, err)
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
