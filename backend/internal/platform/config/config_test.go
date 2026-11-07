package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadReadsEnvironmentWithDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DatabaseURL != "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable" {
		t.Fatalf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.JWTSecret != strings.Repeat("x", 32) {
		t.Fatalf("JWTSecret = %q", cfg.JWTSecret)
	}
	if cfg.MediaRoot != "storage/media" {
		t.Fatalf("MediaRoot = %q", cfg.MediaRoot)
	}
}

func TestLoadReadsProductionSettings(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("ADDR", "127.0.0.1:9090")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1, 10.0.0.0/8")
	t.Setenv("HTTP_WRITE_TIMEOUT", "90s")
	t.Setenv("AUTH_RATE_LIMIT", "20")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Environment != "production" || cfg.Addr != "127.0.0.1:9090" {
		t.Fatalf("unexpected environment settings: %+v", cfg)
	}
	if cfg.WriteTimeout != 90*time.Second || cfg.AuthRateLimit != 20 {
		t.Fatalf("unexpected limits: %+v", cfg)
	}
	if len(cfg.TrustedProxies) != 2 {
		t.Fatalf("TrustedProxies = %#v", cfg.TrustedProxies)
	}
}

func TestLoadParsesMediaUserQuotaBytes(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))

	// 未配置：保持 nil，由 media 包取默认 5 GiB。
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.MediaUserQuotaBytes != nil {
		t.Fatalf("MediaUserQuotaBytes = %v, want nil when unset", *cfg.MediaUserQuotaBytes)
	}

	// 显式配置 0：不限制。
	t.Setenv("MEDIA_USER_QUOTA_BYTES", "0")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.MediaUserQuotaBytes == nil || *cfg.MediaUserQuotaBytes != 0 {
		t.Fatalf("MediaUserQuotaBytes = %v, want 0 (unlimited)", cfg.MediaUserQuotaBytes)
	}

	// 正常覆盖。
	t.Setenv("MEDIA_USER_QUOTA_BYTES", "1073741824")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.MediaUserQuotaBytes == nil || *cfg.MediaUserQuotaBytes != 1073741824 {
		t.Fatalf("MediaUserQuotaBytes = %v, want 1073741824", cfg.MediaUserQuotaBytes)
	}

	// 非法值（负数/非数字）报错。
	for _, raw := range []string{"-1", "abc"} {
		t.Setenv("MEDIA_USER_QUOTA_BYTES", raw)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "MEDIA_USER_QUOTA_BYTES") {
			t.Fatalf("Load() with %q error = %v, want MEDIA_USER_QUOTA_BYTES error", raw, err)
		}
	}
}

func TestLoadParsesPGPoolMaxConns(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))

	// 未配置：保持 0，由 db 包取默认 min(20, max(4, NumCPU))。
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.PoolMaxConns != 0 {
		t.Fatalf("PoolMaxConns = %d, want 0 when unset", cfg.PoolMaxConns)
	}

	t.Setenv("PGPOOL_MAX_CONNS", "42")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.PoolMaxConns != 42 {
		t.Fatalf("PoolMaxConns = %d, want 42", cfg.PoolMaxConns)
	}

	for _, raw := range []string{"0", "-3", "many"} {
		t.Setenv("PGPOOL_MAX_CONNS", raw)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "PGPOOL_MAX_CONNS") {
			t.Fatalf("Load() with %q error = %v, want PGPOOL_MAX_CONNS error", raw, err)
		}
	}
}

func TestLoadRejectsShortSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", "short-secret")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Fatalf("Load() error = %v, want short secret error", err)
	}
}

func TestLoadRejectsInvalidDuration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("HTTP_READ_TIMEOUT", "never")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "HTTP_READ_TIMEOUT") {
		t.Fatalf("Load() error = %v, want duration error", err)
	}
}

func TestLoadReturnsErrorWhenDatabaseURLMissing(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PGHOST", "")
	t.Setenv("JWT_SECRET", "test-secret")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DATABASE_URL is missing")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL or PGHOST is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadAllowsStandardPostgresEnvironment(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PGHOST", "db")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DatabaseURL != "" {
		t.Fatalf("DatabaseURL = %q, want empty so pgx reads PG* variables", cfg.DatabaseURL)
	}
}

func TestLoadReturnsErrorWhenJWTSecretMissing(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable")
	t.Setenv("JWT_SECRET", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_SECRET is missing")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}
