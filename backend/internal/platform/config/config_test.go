package config

import (
	"strings"
	"testing"
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
