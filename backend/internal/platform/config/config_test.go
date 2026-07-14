package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadReadsEnvironmentWithDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable")
	t.Setenv("JWT_SECRET", "test-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DatabaseURL != "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable" {
		t.Fatalf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.JWTSecret != "test-secret" {
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

func TestLoadRejectsShortProductionSecret(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", "short-secret")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Fatalf("Load() error = %v, want production secret error", err)
	}
}

func TestLoadRejectsInvalidDuration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://db/jifo")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("HTTP_READ_TIMEOUT", "never")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "HTTP_READ_TIMEOUT") {
		t.Fatalf("Load() error = %v, want duration error", err)
	}
}

func TestLoadReturnsErrorWhenDatabaseURLMissing(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "test-secret")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DATABASE_URL is missing")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL is required") {
		t.Fatalf("unexpected error: %v", err)
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
