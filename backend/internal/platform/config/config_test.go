package config

import "testing"

func TestLoadReadsEnvironmentWithDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable")
	t.Setenv("JWT_SECRET", "test-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DatabaseURL == "" {
		t.Fatal("DatabaseURL should be set")
	}
	if cfg.JWTSecret != "test-secret" {
		t.Fatalf("JWTSecret = %q", cfg.JWTSecret)
	}
	if cfg.MediaRoot != "storage/media" {
		t.Fatalf("MediaRoot = %q", cfg.MediaRoot)
	}
}
