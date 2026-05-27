package users

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/auth"
	"jifo/backend/internal/platform/testutil"
)

const testAccessTokenSecret = "0123456789abcdef0123456789abcdef"

func TestChangePasswordRevokesAllSessionsAndInvalidatesOldTokens(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	authSvc, err := auth.NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := authSvc.Register(ctx, auth.RegisterInput{
		Email:      "change-password@example.com",
		Password:   "old-password",
		DeviceCode: "device-a",
		DeviceName: "MacBook",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	loggedIn, err := authSvc.Login(ctx, auth.LoginInput{
		Email:      "change-password@example.com",
		Password:   "old-password",
		DeviceCode: "device-b",
		DeviceName: "iPhone",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if _, err := authSvc.ValidateAccessToken(ctx, registered.AccessToken); err != nil {
		t.Fatalf("ValidateAccessToken(registered before change): %v", err)
	}
	if _, err := authSvc.ValidateAccessToken(ctx, loggedIn.AccessToken); err != nil {
		t.Fatalf("ValidateAccessToken(loggedIn before change): %v", err)
	}

	svc := NewService(db)
	if err := svc.ChangePassword(ctx, registered.User.ID, "old-password", "new-password"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}

	var passwordHash string
	err = db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, registered.User.ID).Scan(&passwordHash)
	if err != nil {
		t.Fatalf("query updated password hash: %v", err)
	}
	if auth.VerifyPassword(passwordHash, "old-password") {
		t.Fatal("stored password hash should no longer accept the old password")
	}
	if !auth.VerifyPassword(passwordHash, "new-password") {
		t.Fatal("stored password hash should accept the new password")
	}

	var revokedCount int
	err = db.QueryRow(ctx, `SELECT count(*) FROM user_sessions WHERE user_id = $1 AND revoked_at IS NOT NULL`, registered.User.ID).Scan(&revokedCount)
	if err != nil {
		t.Fatalf("count revoked sessions: %v", err)
	}
	if revokedCount != 2 {
		t.Fatalf("revoked sessions = %d, want 2", revokedCount)
	}

	_, err = authSvc.Refresh(ctx, registered.RefreshToken)
	if !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("refresh after password change error = %v, want %v", err, auth.ErrInvalidRefreshToken)
	}
	_, err = authSvc.Refresh(ctx, loggedIn.RefreshToken)
	if !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("second refresh after password change error = %v, want %v", err, auth.ErrInvalidRefreshToken)
	}
	_, err = authSvc.ValidateAccessToken(ctx, registered.AccessToken)
	if !errors.Is(err, auth.ErrInvalidAccessToken) {
		t.Fatalf("ValidateAccessToken(registered after change) error = %v, want %v", err, auth.ErrInvalidAccessToken)
	}
	_, err = authSvc.ValidateAccessToken(ctx, loggedIn.AccessToken)
	if !errors.Is(err, auth.ErrInvalidAccessToken) {
		t.Fatalf("ValidateAccessToken(loggedIn after change) error = %v, want %v", err, auth.ErrInvalidAccessToken)
	}
}

func TestChangePasswordRejectsWrongCurrentPassword(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	passwordHash, err := auth.HashPassword("correct-password")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	userID := uuid.New()
	_, err = db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, "wrong-current@example.com", passwordHash, "wrong-current")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	svc := NewService(db)
	err = svc.ChangePassword(ctx, userID, "incorrect-password", "new-password")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("ChangePassword error = %v, want %v", err, auth.ErrInvalidCredentials)
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
