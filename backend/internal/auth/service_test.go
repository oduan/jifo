package auth

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

	"jifo/backend/internal/platform/testutil"
)

func TestRegisterNormalizesEmailStoresHashedRefreshTokenAndRejectsDuplicate(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc := NewService(db, "test-secret", time.Hour)

	result, err := svc.Register(ctx, RegisterInput{
		Email:      "  Foo.Bar@Example.COM  ",
		Password:   "super-secret-password",
		DeviceCode: "device-1",
		DeviceName: "MacBook",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	if result.User.Email != "foo.bar@example.com" {
		t.Fatalf("normalized email = %q, want %q", result.User.Email, "foo.bar@example.com")
	}
	if result.User.Username != "foo.bar" {
		t.Fatalf("default username = %q, want %q", result.User.Username, "foo.bar")
	}
	if result.AccessToken == "" || result.RefreshToken == "" {
		t.Fatal("register should return non-empty access and refresh tokens")
	}

	var storedEmail, storedUsername, refreshTokenHash string
	err = db.QueryRow(ctx, `
		SELECT u.email, u.username, s.refresh_token_hash
		FROM users u
		JOIN user_sessions s ON s.user_id = u.id
		WHERE u.id = $1
	`, result.User.ID).Scan(&storedEmail, &storedUsername, &refreshTokenHash)
	if err != nil {
		t.Fatalf("query stored user/session: %v", err)
	}
	if storedEmail != "foo.bar@example.com" {
		t.Fatalf("stored email = %q, want %q", storedEmail, "foo.bar@example.com")
	}
	if storedUsername != "foo.bar" {
		t.Fatalf("stored username = %q, want %q", storedUsername, "foo.bar")
	}
	if refreshTokenHash == "" {
		t.Fatal("refresh token hash must be stored")
	}
	if refreshTokenHash == result.RefreshToken {
		t.Fatal("refresh token must not be stored in plaintext")
	}

	_, err = svc.Register(ctx, RegisterInput{
		Email:      "foo.bar@example.com",
		Password:   "another-password",
		DeviceCode: "device-2",
		DeviceName: "iPhone",
	})
	if !errors.Is(err, ErrEmailAlreadyExists) {
		t.Fatalf("duplicate register error = %v, want %v", err, ErrEmailAlreadyExists)
	}
}

func TestLoginCreatesIndependentSessionsPerDevice(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	passwordHash, err := HashPassword("login-password")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	userID := uuid.New()
	_, err = db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, "login@example.com", passwordHash, "login")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	svc := NewService(db, "test-secret", time.Hour)

	first, err := svc.Login(ctx, LoginInput{
		Email:      "login@example.com",
		Password:   "login-password",
		DeviceCode: "device-a",
		DeviceName: "iPhone",
	})
	if err != nil {
		t.Fatalf("first Login: %v", err)
	}
	second, err := svc.Login(ctx, LoginInput{
		Email:      "login@example.com",
		Password:   "login-password",
		DeviceCode: "device-b",
		DeviceName: "iPad",
	})
	if err != nil {
		t.Fatalf("second Login: %v", err)
	}

	firstClaims, err := ParseAccessToken("test-secret", first.AccessToken)
	if err != nil {
		t.Fatalf("ParseAccessToken(first): %v", err)
	}
	secondClaims, err := ParseAccessToken("test-secret", second.AccessToken)
	if err != nil {
		t.Fatalf("ParseAccessToken(second): %v", err)
	}
	if firstClaims.SessionID == secondClaims.SessionID {
		t.Fatalf("different device logins must create different sessions, both got %s", firstClaims.SessionID)
	}

	var sessionCount int
	err = db.QueryRow(ctx, `SELECT count(*) FROM user_sessions WHERE user_id = $1`, userID).Scan(&sessionCount)
	if err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if sessionCount != 2 {
		t.Fatalf("session count = %d, want 2", sessionCount)
	}
}

func TestRefreshRotatesTokenAndRejectsPreviousRefreshToken(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc := NewService(db, "test-secret", time.Hour)
	registered, err := svc.Register(ctx, RegisterInput{
		Email:      "refresh@example.com",
		Password:   "refresh-password",
		DeviceCode: "device-refresh",
		DeviceName: "Pixel",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	refreshed, err := svc.Refresh(ctx, registered.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if refreshed.RefreshToken == "" || refreshed.AccessToken == "" {
		t.Fatal("refresh should return non-empty access and refresh tokens")
	}
	if refreshed.RefreshToken == registered.RefreshToken {
		t.Fatal("refresh should rotate refresh token")
	}

	_, err = svc.Refresh(ctx, registered.RefreshToken)
	if !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("refresh with old token error = %v, want %v", err, ErrInvalidRefreshToken)
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
