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

const testAccessTokenSecret = "0123456789abcdef0123456789abcdef"

func TestNewServiceValidatesAccessTokenSecret(t *testing.T) {
	tests := []struct {
		name    string
		secret  string
		wantErr bool
	}{
		{name: "empty secret", secret: "", wantErr: true},
		{name: "whitespace secret", secret: "   ", wantErr: true},
		{name: "short secret", secret: "too-short", wantErr: true},
		{name: "valid secret", secret: testAccessTokenSecret, wantErr: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, err := NewService(nil, tt.secret, time.Hour)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidAccessTokenSecret) {
					t.Fatalf("NewService error = %v, want %v", err, ErrInvalidAccessTokenSecret)
				}
				if svc != nil {
					t.Fatal("service must be nil on invalid secret")
				}
				return
			}
			if err != nil {
				t.Fatalf("NewService: %v", err)
			}
			if svc == nil {
				t.Fatal("service must not be nil for valid secret")
			}
		})
	}
}

func TestRegisterNormalizesEmailStoresHashedRefreshTokenAndRejectsDuplicate(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	result, err := svc.Register(ctx, RegisterInput{
		Email:      "  Foo.Bar@Example.COM  ",
		Password:   "super-secret-password",
		DeviceCode: "device-1",
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

	var storedEmail, storedUsername, storedDeviceName, refreshTokenHash string
	err = db.QueryRow(ctx, `
		SELECT u.email, u.username, s.device_name, s.refresh_token_hash
		FROM users u
		JOIN user_sessions s ON s.user_id = u.id
		WHERE u.id = $1
	`, result.User.ID).Scan(&storedEmail, &storedUsername, &storedDeviceName, &refreshTokenHash)
	if err != nil {
		t.Fatalf("query stored user/session: %v", err)
	}
	if storedEmail != "foo.bar@example.com" {
		t.Fatalf("stored email = %q, want %q", storedEmail, "foo.bar@example.com")
	}
	if storedUsername != "foo.bar" {
		t.Fatalf("stored username = %q, want %q", storedUsername, "foo.bar")
	}
	if _, err := uuid.Parse(storedDeviceName); err != nil {
		t.Fatalf("stored device name = %q, want backend-generated UUID: %v", storedDeviceName, err)
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

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	first, err := svc.Login(ctx, LoginInput{
		Email:      "login@example.com",
		Password:   "login-password",
		DeviceCode: "device-a",
	})
	if err != nil {
		t.Fatalf("first Login: %v", err)
	}
	second, err := svc.Login(ctx, LoginInput{
		Email:      "login@example.com",
		Password:   "login-password",
		DeviceCode: "device-b",
	})
	if err != nil {
		t.Fatalf("second Login: %v", err)
	}

	firstClaims, err := ParseAccessToken(testAccessTokenSecret, first.AccessToken)
	if err != nil {
		t.Fatalf("ParseAccessToken(first): %v", err)
	}
	secondClaims, err := ParseAccessToken(testAccessTokenSecret, second.AccessToken)
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

func TestRefreshRotatesTokenAndAllowsPreviousTokenDuringGrace(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := svc.Register(ctx, RegisterInput{
		Email:      "refresh@example.com",
		Password:   "refresh-password",
		DeviceCode: "device-refresh",
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

	retried, err := svc.Refresh(ctx, registered.RefreshToken)
	if err != nil {
		t.Fatalf("refresh with previous token during grace: %v", err)
	}
	if retried.RefreshToken == registered.RefreshToken || retried.RefreshToken == refreshed.RefreshToken {
		t.Fatal("grace retry must issue a fresh replacement token")
	}
	if _, err := svc.Refresh(ctx, refreshed.RefreshToken); err != nil {
		t.Fatalf("concurrently issued sibling token must remain valid: %v", err)
	}
}

func TestRefreshRejectsExpiredSession(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := svc.Register(ctx, RegisterInput{
		Email:      "expired@example.com",
		Password:   "expired-password",
		DeviceCode: "device-expired",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	if _, err := db.Exec(ctx, `UPDATE user_sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, registered.User.ID); err != nil {
		t.Fatalf("backdate expires_at: %v", err)
	}

	_, err = svc.Refresh(ctx, registered.RefreshToken)
	if !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("refresh with expired session error = %v, want %v", err, ErrInvalidRefreshToken)
	}
}

func TestRefreshSlidesExpiry(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := svc.Register(ctx, RegisterInput{
		Email:      "sliding@example.com",
		Password:   "sliding-password",
		DeviceCode: "device-sliding",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Session near expiry but still valid; a refresh must renew the window.
	if _, err := db.Exec(ctx, `UPDATE user_sessions SET expires_at = now() + interval '1 hour' WHERE user_id = $1`, registered.User.ID); err != nil {
		t.Fatalf("shorten expires_at: %v", err)
	}

	if _, err := svc.Refresh(ctx, registered.RefreshToken); err != nil {
		t.Fatalf("Refresh: %v", err)
	}

	var renewed bool
	if err := db.QueryRow(ctx, `SELECT expires_at > now() + interval '29 days' FROM user_sessions WHERE user_id = $1`, registered.User.ID).Scan(&renewed); err != nil {
		t.Fatalf("query expires_at: %v", err)
	}
	if !renewed {
		t.Fatal("refresh should slide expires_at forward by ~30 days")
	}
}

func TestRefreshReplayRevokesSession(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := svc.Register(ctx, RegisterInput{
		Email:      "replay@example.com",
		Password:   "replay-password",
		DeviceCode: "device-replay",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	refreshed, err := svc.Refresh(ctx, registered.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}

	if _, err := db.Exec(ctx, `
		UPDATE session_refresh_tokens
		SET reuse_until = now() - interval '1 second'
		WHERE token_hash = $1
	`, hashRefreshToken(registered.RefreshToken)); err != nil {
		t.Fatalf("expire reuse grace: %v", err)
	}

	// Replaying outside the bounded grace window revokes the session.
	if _, err := svc.Refresh(ctx, registered.RefreshToken); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("replayed refresh error = %v, want %v", err, ErrInvalidRefreshToken)
	}

	var revokedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT revoked_at FROM user_sessions WHERE user_id = $1`, registered.User.ID).Scan(&revokedAt); err != nil {
		t.Fatalf("query revoked_at: %v", err)
	}
	if revokedAt == nil {
		t.Fatal("replay must revoke the session")
	}

	// Even the latest token is now unusable.
	if _, err := svc.Refresh(ctx, refreshed.RefreshToken); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("refresh after replay revocation error = %v, want %v", err, ErrInvalidRefreshToken)
	}
}

func TestValidateAccessTokenRejectsRevokedOrVersionMismatchedSession(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	svc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := svc.Register(ctx, RegisterInput{
		Email:      "validate@example.com",
		Password:   "validate-password",
		DeviceCode: "device-validate",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	claims, err := svc.ValidateAccessToken(ctx, registered.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken(before revoke): %v", err)
	}

	if _, err := db.Exec(ctx, `UPDATE user_sessions SET jwt_version = jwt_version + 1 WHERE id = $1`, claims.SessionID); err != nil {
		t.Fatalf("bump jwt version: %v", err)
	}
	_, err = svc.ValidateAccessToken(ctx, registered.AccessToken)
	if !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("ValidateAccessToken(version mismatch) error = %v, want %v", err, ErrInvalidAccessToken)
	}

	freshLogin, err := svc.Login(ctx, LoginInput{
		Email:      "validate@example.com",
		Password:   "validate-password",
		DeviceCode: "device-validate-2",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	freshClaims, err := svc.ValidateAccessToken(ctx, freshLogin.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken(before revoke fresh): %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE user_sessions SET revoked_at = now() WHERE id = $1`, freshClaims.SessionID); err != nil {
		t.Fatalf("revoke session: %v", err)
	}
	_, err = svc.ValidateAccessToken(ctx, freshLogin.AccessToken)
	if !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("ValidateAccessToken(revoked session) error = %v, want %v", err, ErrInvalidAccessToken)
	}
}

func resetSchemaAndMigrate(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	testutil.ResetDatabase(t, ctx, db)

	for _, name := range []string{"001_init.sql", "006_session_hardening.sql", "009_refresh_token_families.sql"} {
		if _, err := db.Exec(ctx, loadMigration(t, name)); err != nil {
			t.Fatalf("execute migration %s: %v", name, err)
		}
	}
}

func loadMigration(t *testing.T, name string) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve caller: failed")
	}

	migrationPath := filepath.Join(filepath.Dir(file), "..", "..", "migrations", name)
	content, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}

	return string(content)
}
