package accesskeys

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/platform/testutil"
)

func TestGenerateSecretHasJifoPrefixAndEnoughEntropy(t *testing.T) {
	secret, err := generateSecret()
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	if !strings.HasPrefix(secret, "jifo_") {
		t.Fatalf("secret should have jifo_ prefix: %s", secret)
	}
	if len(secret) < 25 {
		t.Fatalf("secret too short: %d", len(secret))
	}
}

func TestMaskSecretHidesMiddle(t *testing.T) {
	secret := "jifo_abcdefghijklmnopqrstuvwxyz"
	prefix, suffix, masked := maskSecret(secret)

	if prefix != "jifo_abcd" {
		t.Fatalf("prefix = %q", prefix)
	}
	if suffix != "vwxyz" {
		t.Fatalf("suffix = %q", suffix)
	}
	if strings.Contains(masked, "efghijklmnopqrstu") {
		t.Fatalf("masked key leaked middle: %s", masked)
	}
	if !strings.HasPrefix(masked, prefix) || !strings.HasSuffix(masked, suffix) {
		t.Fatalf("masked key should keep prefix/suffix: %s", masked)
	}
}

func TestHashSecretIsStableAndDoesNotReturnSecret(t *testing.T) {
	secret := "jifo_abcdefghijklmnopqrstuvwxyz"
	first := hashSecret(secret)
	second := hashSecret(secret)

	if first != second {
		t.Fatal("hash should be stable")
	}
	if first == secret || strings.Contains(first, secret) {
		t.Fatal("hash should not contain raw secret")
	}
	if len(first) != 64 {
		t.Fatalf("sha256 hex length = %d", len(first))
	}
}

func TestRevokeRemovesKeyFromListAndInvalidatesSecret(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db)
	created, err := svc.Create(ctx, userID, "CLI", 0)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := svc.Validate(ctx, created.Secret); err != nil {
		t.Fatalf("Validate() before revoke error = %v", err)
	}

	if err := svc.Revoke(ctx, userID, created.AccessKey.ID); err != nil {
		t.Fatalf("Revoke() error = %v", err)
	}

	items, err := svc.List(ctx, userID)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("List() returned %d items, want 0", len(items))
	}
	_, err = svc.Validate(ctx, created.Secret)
	if !errors.Is(err, ErrInvalidAccessKey) {
		t.Fatalf("Validate() after revoke error = %v, want ErrInvalidAccessKey", err)
	}
}

func TestRevokeRejectsMissingOrCrossUserKey(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	ownerID := insertTestUser(t, ctx, db)
	otherID := insertTestUser(t, ctx, db)

	svc := NewService(db)
	created, err := svc.Create(ctx, ownerID, "CLI", 0)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if err := svc.Revoke(ctx, otherID, created.AccessKey.ID); !errors.Is(err, ErrAccessKeyNotFound) {
		t.Fatalf("cross-user Revoke() error = %v, want ErrAccessKeyNotFound", err)
	}
	if err := svc.Revoke(ctx, ownerID, uuid.New()); !errors.Is(err, ErrAccessKeyNotFound) {
		t.Fatalf("missing Revoke() error = %v, want ErrAccessKeyNotFound", err)
	}
}

func TestValidateRejectsExpiredKey(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db)
	created, err := svc.Create(ctx, userID, "CLI", 30)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.AccessKey.ExpiresAt == nil {
		t.Fatal("ExpiresAt should be set when expiresInDays > 0")
	}
	if _, err := svc.Validate(ctx, created.Secret); err != nil {
		t.Fatalf("Validate() before expiry error = %v", err)
	}

	// 把过期时间回拨到过去，模拟已过期。
	if _, err := db.Exec(ctx, `UPDATE access_keys SET expires_at = now() - interval '1 hour' WHERE id = $1`, created.AccessKey.ID); err != nil {
		t.Fatalf("backdate expiry: %v", err)
	}
	if _, err := svc.Validate(ctx, created.Secret); !errors.Is(err, ErrInvalidAccessKey) {
		t.Fatalf("Validate() after expiry error = %v, want ErrInvalidAccessKey", err)
	}
}

func TestCreateWithoutExpiryStaysPermanent(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)
	userID := insertTestUser(t, ctx, db)

	svc := NewService(db)
	created, err := svc.Create(ctx, userID, "CLI", 0)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.AccessKey.ExpiresAt != nil {
		t.Fatalf("ExpiresAt = %v, want nil for permanent key", created.AccessKey.ExpiresAt)
	}
}

func resetSchemaAndMigrate(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	testutil.ResetDatabase(t, ctx, db)

	for _, migration := range []string{"001_init.sql", "002_access_keys.sql", "007_access_key_expiry.sql"} {
		if _, err := db.Exec(ctx, loadMigration(t, migration)); err != nil {
			t.Fatalf("execute %s: %v", migration, err)
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
		t.Fatalf("read migration %s: %v", name, err)
	}
	return string(content)
}

func insertTestUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()
	userID := uuid.New()
	_, err := db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, username)
		VALUES ($1, $2, $3, $4)
	`, userID, userID.String()+"@example.com", "hash", "access-key-user")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return userID
}
