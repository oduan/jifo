package commands

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	"jifo/cli/internal/config"
)

func executeForTest(t *testing.T, opts Options, args ...string) (string, error) {
	t.Helper()
	cmd := NewRootCommand(opts)
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs(args)
	err := cmd.Execute()
	return out.String(), err
}

func TestLoginStatusAndLogout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	out, err := executeForTest(t, Options{ConfigPath: path}, "login", "--token", "jifo_secret", "--base-url", "https://example.test/api")
	if err != nil {
		t.Fatalf("login error = %v output=%s", err, out)
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if loaded.BaseURL != "https://example.test/api" || loaded.AccessToken != "jifo_secret" {
		t.Fatalf("config = %+v", loaded)
	}

	out, err = executeForTest(t, Options{ConfigPath: path}, "status")
	if err != nil {
		t.Fatalf("status error = %v", err)
	}
	if !strings.Contains(out, "https://example.test/api") || !strings.Contains(out, "Token: configured") || strings.Contains(out, "jifo_secret") {
		t.Fatalf("unexpected status output:\n%s", out)
	}

	_, err = executeForTest(t, Options{ConfigPath: path}, "logout")
	if err != nil {
		t.Fatalf("logout error = %v", err)
	}
	after, _ := config.Load(path)
	if after.AccessToken != "" || after.BaseURL != "https://example.test/api" {
		t.Fatalf("after logout = %+v", after)
	}
}

func TestLoginRequiresToken(t *testing.T) {
	_, err := executeForTest(t, Options{ConfigPath: filepath.Join(t.TempDir(), "config.json")}, "login")
	if err == nil || !strings.Contains(err.Error(), "--token is required") {
		t.Fatalf("err = %v, want token required", err)
	}
}
