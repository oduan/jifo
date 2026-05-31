package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadUsesDefaultsWhenConfigMissing(t *testing.T) {
	dir := t.TempDir()
	cfg, err := Load(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.BaseURL != DefaultBaseURL {
		t.Fatalf("BaseURL = %q, want %q", cfg.BaseURL, DefaultBaseURL)
	}
	if cfg.AccessToken != "" {
		t.Fatalf("AccessToken = %q, want empty", cfg.AccessToken)
	}
	if cfg.TokenSource != TokenSourceNone {
		t.Fatalf("TokenSource = %q, want %q", cfg.TokenSource, TokenSourceNone)
	}
}

func TestSaveLoadAndLogoutPreservesBaseURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	initial := Config{BaseURL: "https://example.test/api", AccessToken: "jifo_secret"}
	if err := Save(path, initial); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if loaded.BaseURL != initial.BaseURL || loaded.AccessToken != initial.AccessToken {
		t.Fatalf("loaded = %+v, want %+v", loaded, initial)
	}
	if loaded.TokenSource != TokenSourceConfig {
		t.Fatalf("TokenSource = %q, want %q", loaded.TokenSource, TokenSourceConfig)
	}

	if err := Logout(path); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	after, err := Load(path)
	if err != nil {
		t.Fatalf("Load() after logout error = %v", err)
	}
	if after.BaseURL != initial.BaseURL {
		t.Fatalf("BaseURL after logout = %q, want %q", after.BaseURL, initial.BaseURL)
	}
	if after.AccessToken != "" || after.TokenSource != TokenSourceNone {
		t.Fatalf("token after logout = %q source %q, want empty none", after.AccessToken, after.TokenSource)
	}
}

func TestEnvironmentOverridesConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := Save(path, Config{BaseURL: "https://config.test/api", AccessToken: "config-token"}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	t.Setenv("JIFO_BASE_URL", "https://env.test/api")
	t.Setenv("JIFO_ACCESS_TOKEN", "env-token")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.BaseURL != "https://env.test/api" {
		t.Fatalf("BaseURL = %q, want env override", cfg.BaseURL)
	}
	if cfg.AccessToken != "env-token" {
		t.Fatalf("AccessToken = %q, want env override", cfg.AccessToken)
	}
	if cfg.TokenSource != TokenSourceEnv {
		t.Fatalf("TokenSource = %q, want %q", cfg.TokenSource, TokenSourceEnv)
	}
}

func TestDefaultPathUsesHomeDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	// Windows uses USERPROFILE. Set both to make test deterministic across platforms.
	t.Setenv("USERPROFILE", home)

	path, err := DefaultPath()
	if err != nil {
		t.Fatalf("DefaultPath() error = %v", err)
	}
	want := filepath.Join(home, ".jifo", "config.json")
	if path != want {
		t.Fatalf("DefaultPath() = %q, want %q", path, want)
	}
	_ = os.PathSeparator
}
