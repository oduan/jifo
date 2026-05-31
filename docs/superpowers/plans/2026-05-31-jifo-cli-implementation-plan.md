# Jifo CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent Go+Cobra CLI for Jifo notes/tags and a project skill that teaches AI agents to use it safely.

**Architecture:** Add a new standalone `cli/` Go module that talks to the existing Jifo HTTP API only. Keep configuration, API client, output formatting, and Cobra commands separated so each unit is testable. Add a project-level `.agents/skills/jifo-cli/SKILL.md` for agent usage patterns.

**Tech Stack:** Go 1.25.7-compatible module, Cobra, Go standard library HTTP/JSON/filesystem packages, project skill markdown.

---

## File Structure

- Create `cli/go.mod`: standalone module `jifo/cli` with Cobra dependency.
- Create `cli/cmd/jifo/main.go`: small executable entrypoint.
- Create `cli/internal/config/config.go`: config file read/write, default values, env overrides, token source reporting.
- Create `cli/internal/config/config_test.go`: TDD tests for config behavior.
- Create `cli/internal/api/types.go`: DTOs matching current Jifo API responses.
- Create `cli/internal/api/client.go`: HTTP client and API methods.
- Create `cli/internal/api/client_test.go`: TDD tests for request paths, headers, payloads, and errors.
- Create `cli/internal/output/output.go`: human and JSON output helpers.
- Create `cli/internal/output/output_test.go`: TDD tests for output formatting.
- Create `cli/internal/commands/root.go`: root command, dependency injection, config loading, common flags.
- Create `cli/internal/commands/auth.go`: `login`, `logout`, `status` commands.
- Create `cli/internal/commands/notes.go`: `notes list`, `notes create` commands.
- Create `cli/internal/commands/tags.go`: `tags list`, `tags tree` commands.
- Create command tests in `cli/internal/commands/*_test.go`: CLI behavior tests using fakes and temp config.
- Create `.agents/skills/jifo-cli/SKILL.md`: project skill for AI agents.
- Modify `README.md`: add short CLI usage and test commands.

---

### Task 1: Bootstrap standalone CLI module

**Files:**
- Create: `cli/go.mod`
- Create: `cli/cmd/jifo/main.go`
- Create: `cli/internal/commands/root.go`
- Test: `cli/internal/commands/root_test.go`

- [ ] **Step 1: Create module skeleton**

Run:

```bash
mkdir -p cli/cmd/jifo cli/internal/commands
cd cli
go mod init jifo/cli
go get github.com/spf13/cobra@latest
```

Expected: `cli/go.mod` and `cli/go.sum` exist.

- [ ] **Step 2: Write failing root command test**

Create `cli/internal/commands/root_test.go`:

```go
package commands

import (
	"bytes"
	"testing"
)

func TestRootCommandShowsHelp(t *testing.T) {
	cmd := NewRootCommand(Options{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	got := out.String()
	for _, want := range []string{"jifo", "notes", "tags", "login", "status"} {
		if !bytes.Contains([]byte(got), []byte(want)) {
			t.Fatalf("help output missing %q:\n%s", want, got)
		}
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd cli
go test ./internal/commands -run TestRootCommandShowsHelp -v
```

Expected: FAIL because `NewRootCommand` and `Options` do not exist.

- [ ] **Step 4: Implement minimal root command**

Create `cli/internal/commands/root.go`:

```go
package commands

import "github.com/spf13/cobra"

type Options struct{}

func NewRootCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "jifo",
		Short: "Jifo command line client",
	}
	cmd.AddCommand(newLoginCommand(opts))
	cmd.AddCommand(newLogoutCommand(opts))
	cmd.AddCommand(newStatusCommand(opts))
	cmd.AddCommand(newNotesCommand(opts))
	cmd.AddCommand(newTagsCommand(opts))
	return cmd
}

func newLoginCommand(opts Options) *cobra.Command {
	return &cobra.Command{Use: "login", Short: "Save Jifo access token"}
}

func newLogoutCommand(opts Options) *cobra.Command {
	return &cobra.Command{Use: "logout", Short: "Remove saved Jifo access token"}
}

func newStatusCommand(opts Options) *cobra.Command {
	return &cobra.Command{Use: "status", Short: "Show Jifo CLI configuration status"}
}

func newNotesCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "notes", Short: "Work with notes"}
	cmd.AddCommand(&cobra.Command{Use: "list", Short: "List notes"})
	cmd.AddCommand(&cobra.Command{Use: "create", Short: "Create a text note"})
	return cmd
}

func newTagsCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "tags", Short: "Work with tags"}
	cmd.AddCommand(&cobra.Command{Use: "list", Short: "List tags"})
	cmd.AddCommand(&cobra.Command{Use: "tree", Short: "Show tag tree"})
	return cmd
}
```

Create `cli/cmd/jifo/main.go`:

```go
package main

import (
	"fmt"
	"os"

	"jifo/cli/internal/commands"
)

func main() {
	cmd := commands.NewRootCommand(commands.Options{})
	if err := cmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd cli
go test ./internal/commands -run TestRootCommandShowsHelp -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli
git commit -m "feat(cli): bootstrap cobra module" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 2: Implement config loading, env overrides, and persistence

**Files:**
- Create: `cli/internal/config/config.go`
- Test: `cli/internal/config/config_test.go`

- [ ] **Step 1: Write failing config tests**

Create `cli/internal/config/config_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd cli
go test ./internal/config -v
```

Expected: FAIL because package does not exist or functions are undefined.

- [ ] **Step 3: Implement config package**

Create `cli/internal/config/config.go`:

```go
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const DefaultBaseURL = "http://localhost:8080/api"

const (
	TokenSourceNone   = "none"
	TokenSourceConfig = "config"
	TokenSourceEnv    = "env"
)

type Config struct {
	BaseURL     string `json:"baseUrl"`
	AccessToken string `json:"accessToken"`
	TokenSource string `json:"-"`
}

func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".jifo", "config.json"), nil
}

func Load(path string) (Config, error) {
	cfg := Config{BaseURL: DefaultBaseURL, TokenSource: TokenSourceNone}
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return Config{}, err
		}
	} else if len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return Config{}, err
		}
	}
	cfg.BaseURL = strings.TrimSpace(cfg.BaseURL)
	cfg.AccessToken = strings.TrimSpace(cfg.AccessToken)
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.AccessToken != "" {
		cfg.TokenSource = TokenSourceConfig
	}
	if envBaseURL := strings.TrimSpace(os.Getenv("JIFO_BASE_URL")); envBaseURL != "" {
		cfg.BaseURL = envBaseURL
	}
	if envToken := strings.TrimSpace(os.Getenv("JIFO_ACCESS_TOKEN")); envToken != "" {
		cfg.AccessToken = envToken
		cfg.TokenSource = TokenSourceEnv
	}
	return cfg, nil
}

func Save(path string, cfg Config) error {
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(Config{BaseURL: cfg.BaseURL, AccessToken: cfg.AccessToken}, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func Logout(path string) error {
	cfg, err := Load(path)
	if err != nil {
		return err
	}
	cfg.AccessToken = ""
	cfg.TokenSource = TokenSourceNone
	return Save(path, cfg)
}
```

- [ ] **Step 4: Run config tests**

Run:

```bash
cd cli
go test ./internal/config -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config
git commit -m "feat(cli): add config persistence" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 3: Implement API client DTOs, requests, and errors

**Files:**
- Create: `cli/internal/api/types.go`
- Create: `cli/internal/api/client.go`
- Test: `cli/internal/api/client_test.go`

- [ ] **Step 1: Write failing API client tests**

Create `cli/internal/api/client_test.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListNotesSendsAuthAndQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/notes" {
			t.Fatalf("path = %q, want /api/notes", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q", got)
		}
		q := r.URL.Query()
		if q.Get("search") != "hello" || q.Get("tagPath") != "思考" || q.Get("trash") != "true" || q.Get("limit") != "20" || q.Get("offset") != "40" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"note-1","plainText":"hello #思考","version":1}]}`))
	}))
	defer server.Close()

	limit, offset := 20, 40
	client := NewClient(server.URL+"/api", "secret", server.Client())
	resp, err := client.ListNotes(context.Background(), ListNotesParams{Search: "hello", TagPath: "思考", Trash: true, Limit: &limit, Offset: &offset})
	if err != nil {
		t.Fatalf("ListNotes() error = %v", err)
	}
	if len(resp.Items) != 1 || resp.Items[0].ID != "note-1" {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestCreateNoteSendsExpectedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/notes" {
			t.Fatalf("method/path = %s %s", r.Method, r.URL.Path)
		}
		var body CreateNoteInput
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if !strings.HasPrefix(body.ClientID, "cli-") {
			t.Fatalf("ClientID = %q, want cli- prefix", body.ClientID)
		}
		if body.PlainText != "new note #tag" {
			t.Fatalf("PlainText = %q", body.PlainText)
		}
		if len(body.Content.Blocks) != 1 || body.Content.Blocks[0].Type != "paragraph" || body.Content.Blocks[0].Text != body.PlainText {
			t.Fatalf("Content = %+v", body.Content)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"item":{"id":"note-2","plainText":"new note #tag","version":1}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL+"/api", "secret", server.Client())
	resp, err := client.CreateTextNote(context.Background(), "new note #tag")
	if err != nil {
		t.Fatalf("CreateTextNote() error = %v", err)
	}
	if resp.Item.ID != "note-2" {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestListTagsAndTree(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"items":[{"ID":"1","Name":"思考","Path":"思考","NoteCount":2}]}`))
		case "/api/tags/tree":
			_, _ = w.Write([]byte(`{"items":[{"id":"1","name":"思考","path":"思考","noteCount":2,"children":[{"id":"2","name":"子","path":"思考/子","noteCount":1}]}]}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := NewClient(server.URL+"/api", "secret", server.Client())
	tags, err := client.ListTags(context.Background())
	if err != nil {
		t.Fatalf("ListTags() error = %v", err)
	}
	if tags.Items[0].Path != "思考" || tags.Items[0].NoteCount != 2 {
		t.Fatalf("tags = %+v", tags)
	}
	tree, err := client.TagTree(context.Background())
	if err != nil {
		t.Fatalf("TagTree() error = %v", err)
	}
	if tree.Items[0].Children[0].Path != "思考/子" {
		t.Fatalf("tree = %+v", tree)
	}
}

func TestAPIErrorIncludesCodeMessageAndRequestID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"invalid access token","requestId":"req-1"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL+"/api", "secret", server.Client())
	_, err := client.ListTags(context.Background())
	if err == nil {
		t.Fatal("ListTags() error = nil, want error")
	}
	for _, want := range []string{"unauthorized", "invalid access token", "req-1"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q missing %q", err.Error(), want)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd cli
go test ./internal/api -v
```

Expected: FAIL because api package implementation does not exist.

- [ ] **Step 3: Implement API types**

Create `cli/internal/api/types.go`:

```go
package api

import "time"

type Block struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type Content struct {
	Blocks []Block `json:"blocks"`
}

type Note struct {
	ID        string     `json:"id"`
	ClientID  string     `json:"clientId,omitempty"`
	Content   Content    `json:"content,omitempty"`
	PlainText string     `json:"plainText"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	Version   int64      `json:"version"`
}

type NotesResponse struct {
	Items []Note `json:"items"`
}

type NoteResponse struct {
	Item Note `json:"item"`
}

type CreateNoteInput struct {
	ClientID  string  `json:"clientId"`
	Content   Content `json:"content"`
	PlainText string  `json:"plainText"`
}

type ListNotesParams struct {
	Search  string
	TagPath string
	Trash   bool
	Limit   *int
	Offset  *int
}

type Tag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	ParentID  string `json:"parentId,omitempty"`
	Depth     int    `json:"depth"`
	NoteCount int    `json:"noteCount"`
}

type TagsResponse struct {
	Items []Tag `json:"items"`
}

type TagTreeResponse struct {
	Items []TagNode `json:"items"`
}

type TagNode struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	ParentID  string    `json:"parentId,omitempty"`
	Depth     int       `json:"depth"`
	NoteCount int       `json:"noteCount"`
	Children  []TagNode `json:"children,omitempty"`
}
```

- [ ] **Step 4: Implement API client**

Create `cli/internal/api/client.go`:

```go
package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	baseURL     string
	accessToken string
	httpClient  *http.Client
}

type apiErrorBody struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
	} `json:"error"`
}

func NewClient(baseURL, accessToken string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), accessToken: strings.TrimSpace(accessToken), httpClient: httpClient}
}

func (c *Client) ListNotes(ctx context.Context, params ListNotesParams) (NotesResponse, error) {
	values := url.Values{}
	if params.Search != "" {
		values.Set("search", params.Search)
	}
	if params.TagPath != "" {
		values.Set("tagPath", params.TagPath)
	}
	if params.Trash {
		values.Set("trash", "true")
	}
	if params.Limit != nil {
		values.Set("limit", strconv.Itoa(*params.Limit))
	}
	if params.Offset != nil {
		values.Set("offset", strconv.Itoa(*params.Offset))
	}
	path := "/notes"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out NotesResponse
	err := c.do(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) CreateTextNote(ctx context.Context, text string) (NoteResponse, error) {
	input := CreateNoteInput{
		ClientID:  "cli-" + randomHex(16),
		PlainText: text,
		Content:   Content{Blocks: []Block{{Type: "paragraph", Text: text}}},
	}
	return c.CreateNote(ctx, input)
}

func (c *Client) CreateNote(ctx context.Context, input CreateNoteInput) (NoteResponse, error) {
	var out NoteResponse
	err := c.do(ctx, http.MethodPost, "/notes", input, &out)
	return out, err
}

func (c *Client) ListTags(ctx context.Context) (TagsResponse, error) {
	var out TagsResponse
	err := c.do(ctx, http.MethodGet, "/tags", nil, &out)
	return out, err
}

func (c *Client) TagTree(ctx context.Context) (TagTreeResponse, error) {
	var out TagTreeResponse
	err := c.do(ctx, http.MethodGet, "/tags/tree", nil, &out)
	return out, err
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	if c.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return decodeAPIError(resp.StatusCode, data)
	}
	if out == nil || len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func decodeAPIError(status int, data []byte) error {
	var parsed apiErrorBody
	if err := json.Unmarshal(data, &parsed); err == nil && parsed.Error.Code != "" {
		if parsed.Error.RequestID != "" {
			return fmt.Errorf("jifo api error: status=%d code=%s message=%s requestId=%s", status, parsed.Error.Code, parsed.Error.Message, parsed.Error.RequestID)
		}
		return fmt.Errorf("jifo api error: status=%d code=%s message=%s", status, parsed.Error.Code, parsed.Error.Message)
	}
	body := strings.TrimSpace(string(data))
	if len(body) > 500 {
		body = body[:500]
	}
	return fmt.Errorf("jifo api error: status=%d body=%s", status, body)
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buf)
}
```

- [ ] **Step 5: Run API tests**

Run:

```bash
cd cli
go test ./internal/api -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/api
git commit -m "feat(cli): add jifo api client" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 4: Implement output helpers

**Files:**
- Create: `cli/internal/output/output.go`
- Test: `cli/internal/output/output_test.go`

- [ ] **Step 1: Write failing output tests**

Create `cli/internal/output/output_test.go`:

```go
package output

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"jifo/cli/internal/api"
)

func TestJSONWritesValidJSON(t *testing.T) {
	var out bytes.Buffer
	if err := JSON(&out, map[string]any{"items": []string{"a"}}); err != nil {
		t.Fatalf("JSON() error = %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(out.Bytes(), &decoded); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, out.String())
	}
}

func TestNotesTableIncludesPreviewAndHeader(t *testing.T) {
	var out bytes.Buffer
	created := time.Date(2026, 5, 31, 9, 10, 0, 0, time.UTC)
	WriteNotes(&out, []api.Note{{ID: "1234567890abcdef", PlainText: "hello\nworld", CreatedAt: created, UpdatedAt: created, Version: 2}})
	got := out.String()
	for _, want := range []string{"ID", "Created", "Version", "12345678", "hello world"} {
		if !strings.Contains(got, want) {
			t.Fatalf("output missing %q:\n%s", want, got)
		}
	}
}

func TestTagsTreeUsesIndentation(t *testing.T) {
	var out bytes.Buffer
	WriteTagTree(&out, []api.TagNode{{Name: "思考", Path: "思考", NoteCount: 2, Children: []api.TagNode{{Name: "子", Path: "思考/子", NoteCount: 1}}}})
	got := out.String()
	if !strings.Contains(got, "思考 (2)") || !strings.Contains(got, "  思考/子 (1)") {
		t.Fatalf("unexpected tree output:\n%s", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd cli
go test ./internal/output -v
```

Expected: FAIL because output package implementation does not exist.

- [ ] **Step 3: Implement output helpers**

Create `cli/internal/output/output.go`:

```go
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
	"time"
	"unicode/utf8"

	"jifo/cli/internal/api"
)

func JSON(w io.Writer, value any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func WriteNotes(w io.Writer, notes []api.Note) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tCreated\tUpdated\tVersion\tPreview")
	for _, note := range notes {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n", shortID(note.ID), formatTime(note.CreatedAt), formatTime(note.UpdatedAt), note.Version, preview(note.PlainText, 80))
	}
	_ = tw.Flush()
}

func WriteCreatedNote(w io.Writer, note api.Note) {
	fmt.Fprintf(w, "Created note %s at %s\n%s\n", shortID(note.ID), formatTime(note.CreatedAt), preview(note.PlainText, 120))
}

func WriteTags(w io.Writer, tags []api.Tag) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "Path\tNotes")
	for _, tag := range tags {
		path := tag.Path
		if path == "" {
			path = tag.Name
		}
		fmt.Fprintf(tw, "%s\t%d\n", path, tag.NoteCount)
	}
	_ = tw.Flush()
}

func WriteTagTree(w io.Writer, nodes []api.TagNode) {
	for _, node := range nodes {
		writeTagNode(w, node, 0)
	}
}

func writeTagNode(w io.Writer, node api.TagNode, depth int) {
	path := node.Path
	if path == "" {
		path = node.Name
	}
	fmt.Fprintf(w, "%s%s (%d)\n", strings.Repeat("  ", depth), path, node.NoteCount)
	for _, child := range node.Children {
		writeTagNode(w, child, depth+1)
	}
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	return t.Local().Format("2006-01-02 15:04")
}

func preview(text string, maxRunes int) string {
	cleaned := strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(cleaned) <= maxRunes {
		return cleaned
	}
	runes := []rune(cleaned)
	return string(runes[:maxRunes]) + "…"
}
```

- [ ] **Step 4: Run output tests**

Run:

```bash
cd cli
go test ./internal/output -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/output
git commit -m "feat(cli): add output formatting" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 5: Implement auth commands

**Files:**
- Modify: `cli/internal/commands/root.go`
- Create: `cli/internal/commands/auth.go`
- Test: `cli/internal/commands/auth_test.go`

- [ ] **Step 1: Write failing auth command tests**

Create `cli/internal/commands/auth_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd cli
go test ./internal/commands -run 'TestLogin|TestRoot' -v
```

Expected: FAIL because `Options.ConfigPath` and auth behavior are not implemented.

- [ ] **Step 3: Update root options and command wiring**

Modify `cli/internal/commands/root.go` so the top section becomes:

```go
package commands

import (
	"fmt"

	"github.com/spf13/cobra"

	"jifo/cli/internal/config"
)

type Options struct {
	ConfigPath string
}

func (o Options) configPath() (string, error) {
	if o.ConfigPath != "" {
		return o.ConfigPath, nil
	}
	return config.DefaultPath()
}

func NewRootCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:           "jifo",
		Short:         "Jifo command line client",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	cmd.AddCommand(newLoginCommand(opts))
	cmd.AddCommand(newLogoutCommand(opts))
	cmd.AddCommand(newStatusCommand(opts))
	cmd.AddCommand(newNotesCommand(opts))
	cmd.AddCommand(newTagsCommand(opts))
	return cmd
}

func missingTokenError() error {
	return fmt.Errorf("missing access token: run `jifo login --token <access-key>` or set JIFO_ACCESS_TOKEN")
}
```

Remove the stub `newLoginCommand`, `newLogoutCommand`, and `newStatusCommand` from `root.go` after creating `auth.go`.

- [ ] **Step 4: Implement auth commands**

Create `cli/internal/commands/auth.go`:

```go
package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"jifo/cli/internal/config"
)

func newLoginCommand(opts Options) *cobra.Command {
	var token string
	var baseURL string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Save Jifo access token",
		RunE: func(cmd *cobra.Command, args []string) error {
			token = strings.TrimSpace(token)
			if token == "" {
				return fmt.Errorf("--token is required")
			}
			path, err := opts.configPath()
			if err != nil {
				return err
			}
			cfg, err := config.Load(path)
			if err != nil {
				return err
			}
			if strings.TrimSpace(baseURL) != "" {
				cfg.BaseURL = strings.TrimSpace(baseURL)
			}
			cfg.AccessToken = token
			if err := config.Save(path, cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Saved Jifo access token for %s\n", cfg.BaseURL)
			return nil
		},
	}
	cmd.Flags().StringVar(&token, "token", "", "Jifo access key")
	cmd.Flags().StringVar(&baseURL, "base-url", "", "Jifo API base URL")
	return cmd
}

func newLogoutCommand(opts Options) *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Remove saved Jifo access token",
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := opts.configPath()
			if err != nil {
				return err
			}
			if err := config.Logout(path); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Removed saved Jifo access token")
			return nil
		},
	}
}

func newStatusCommand(opts Options) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show Jifo CLI configuration status",
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := opts.configPath()
			if err != nil {
				return err
			}
			cfg, err := config.Load(path)
			if err != nil {
				return err
			}
			tokenStatus := "not configured"
			if cfg.AccessToken != "" {
				tokenStatus = "configured"
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Base URL: %s\n", cfg.BaseURL)
			fmt.Fprintf(cmd.OutOrStdout(), "Token: %s\n", tokenStatus)
			fmt.Fprintf(cmd.OutOrStdout(), "Token source: %s\n", cfg.TokenSource)
			return nil
		},
	}
}
```

- [ ] **Step 5: Run auth command tests**

Run:

```bash
cd cli
go test ./internal/commands -run 'TestLogin|TestRoot' -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/commands cli/internal/config
git commit -m "feat(cli): add auth commands" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 6: Implement notes commands

**Files:**
- Modify: `cli/internal/commands/root.go`
- Create: `cli/internal/commands/notes.go`
- Test: `cli/internal/commands/notes_test.go`

- [ ] **Step 1: Refactor commands for injectable API factory with failing tests**

Create `cli/internal/commands/notes_test.go`:

```go
package commands

import (
	"context"
	"strings"
	"testing"
	"time"

	"jifo/cli/internal/api"
	"jifo/cli/internal/config"
)

type fakeNotesAPI struct {
	listParams api.ListNotesParams
	createdText string
}

func (f *fakeNotesAPI) ListNotes(ctx context.Context, params api.ListNotesParams) (api.NotesResponse, error) {
	f.listParams = params
	created := time.Date(2026, 5, 31, 9, 10, 0, 0, time.UTC)
	return api.NotesResponse{Items: []api.Note{{ID: "1234567890", PlainText: "hello #tag", CreatedAt: created, UpdatedAt: created, Version: 1}}}, nil
}
func (f *fakeNotesAPI) CreateTextNote(ctx context.Context, text string) (api.NoteResponse, error) {
	f.createdText = text
	created := time.Date(2026, 5, 31, 9, 10, 0, 0, time.UTC)
	return api.NoteResponse{Item: api.Note{ID: "created-note", PlainText: text, CreatedAt: created, UpdatedAt: created, Version: 1}}, nil
}
func (f *fakeNotesAPI) ListTags(ctx context.Context) (api.TagsResponse, error) { return api.TagsResponse{}, nil }
func (f *fakeNotesAPI) TagTree(ctx context.Context) (api.TagTreeResponse, error) { return api.TagTreeResponse{}, nil }

func TestNotesListPassesFiltersAndWritesJSON(t *testing.T) {
	fake := &fakeNotesAPI{}
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{BaseURL: "http://x/api", AccessToken: "token", TokenSource: config.TokenSourceConfig}, nil },
		NewAPI: func(cfg config.Config) API { return fake },
	}, "notes", "list", "--search", "hello", "--tag", "思考", "--trash", "--limit", "20", "--offset", "40", "--json")
	if err != nil {
		t.Fatalf("notes list error = %v output=%s", err, out)
	}
	if fake.listParams.Search != "hello" || fake.listParams.TagPath != "思考" || !fake.listParams.Trash || *fake.listParams.Limit != 20 || *fake.listParams.Offset != 40 {
		t.Fatalf("params = %+v", fake.listParams)
	}
	if !strings.Contains(out, `"items"`) || strings.Contains(out, "Preview") {
		t.Fatalf("unexpected json output:\n%s", out)
	}
}

func TestNotesListRejectsNegativePagination(t *testing.T) {
	_, err := executeForTest(t, Options{LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil }}, "notes", "list", "--limit", "-1")
	if err == nil || !strings.Contains(err.Error(), "--limit must be >= 0") {
		t.Fatalf("err = %v", err)
	}
}

func TestNotesCreateRequiresExactlyOneInput(t *testing.T) {
	_, err := executeForTest(t, Options{LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil }}, "notes", "create")
	if err == nil || !strings.Contains(err.Error(), "provide exactly one") {
		t.Fatalf("err = %v", err)
	}
}

func TestNotesCreateText(t *testing.T) {
	fake := &fakeNotesAPI{}
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{BaseURL: "http://x/api", AccessToken: "token"}, nil },
		NewAPI: func(cfg config.Config) API { return fake },
	}, "notes", "create", "--text", "new note #tag", "--json")
	if err != nil {
		t.Fatalf("notes create error = %v output=%s", err, out)
	}
	if fake.createdText != "new note #tag" {
		t.Fatalf("createdText = %q", fake.createdText)
	}
	if !strings.Contains(out, `"item"`) || !strings.Contains(out, "new note #tag") {
		t.Fatalf("unexpected output:\n%s", out)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd cli
go test ./internal/commands -run 'TestNotes|TestLogin|TestRoot' -v
```

Expected: FAIL because `Options.LoadConfig`, `Options.NewAPI`, `API`, and real notes commands do not exist.

- [ ] **Step 3: Update root command dependencies**

Modify `cli/internal/commands/root.go` to include:

```go
package commands

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"jifo/cli/internal/api"
	"jifo/cli/internal/config"
)

type API interface {
	ListNotes(ctx context.Context, params api.ListNotesParams) (api.NotesResponse, error)
	CreateTextNote(ctx context.Context, text string) (api.NoteResponse, error)
	ListTags(ctx context.Context) (api.TagsResponse, error)
	TagTree(ctx context.Context) (api.TagTreeResponse, error)
}

type Options struct {
	ConfigPath string
	LoadConfig func() (config.Config, error)
	NewAPI     func(config.Config) API
}

func (o Options) configPath() (string, error) {
	if o.ConfigPath != "" {
		return o.ConfigPath, nil
	}
	return config.DefaultPath()
}

func (o Options) loadConfig() (config.Config, error) {
	if o.LoadConfig != nil {
		return o.LoadConfig()
	}
	path, err := o.configPath()
	if err != nil {
		return config.Config{}, err
	}
	return config.Load(path)
}

func (o Options) api(cfg config.Config) API {
	if o.NewAPI != nil {
		return o.NewAPI(cfg)
	}
	return api.NewClient(cfg.BaseURL, cfg.AccessToken, nil)
}

func requireAPI(opts Options) (config.Config, API, error) {
	cfg, err := opts.loadConfig()
	if err != nil {
		return config.Config{}, nil, err
	}
	if cfg.AccessToken == "" {
		return config.Config{}, nil, missingTokenError()
	}
	return cfg, opts.api(cfg), nil
}
```

Keep `NewRootCommand` and `missingTokenError` from Task 5. Remove notes stub from `root.go` after creating `notes.go`.

- [ ] **Step 4: Implement notes commands**

Create `cli/internal/commands/notes.go`:

```go
package commands

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"jifo/cli/internal/api"
	"jifo/cli/internal/output"
)

func newNotesCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "notes", Short: "Work with notes"}
	cmd.AddCommand(newNotesListCommand(opts))
	cmd.AddCommand(newNotesCreateCommand(opts))
	return cmd
}

func newNotesListCommand(opts Options) *cobra.Command {
	var search, tag string
	var trash, asJSON bool
	var limit, offset int
	var hasLimit, hasOffset bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List notes",
		RunE: func(cmd *cobra.Command, args []string) error {
			if hasLimit && limit < 0 {
				return fmt.Errorf("--limit must be >= 0")
			}
			if hasOffset && offset < 0 {
				return fmt.Errorf("--offset must be >= 0")
			}
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			params := api.ListNotesParams{Search: search, TagPath: tag, Trash: trash}
			if hasLimit {
				params.Limit = &limit
			}
			if hasOffset {
				params.Offset = &offset
			}
			resp, err := client.ListNotes(cmd.Context(), params)
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteNotes(cmd.OutOrStdout(), resp.Items)
			return nil
		},
	}
	cmd.Flags().StringVar(&search, "search", "", "Search note text")
	cmd.Flags().StringVar(&tag, "tag", "", "Filter by tag path")
	cmd.Flags().BoolVar(&trash, "trash", false, "List trashed notes")
	cmd.Flags().IntVar(&limit, "limit", 0, "Maximum notes to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "Number of notes to skip")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	cmd.PreRun = func(cmd *cobra.Command, args []string) {
		hasLimit = cmd.Flags().Changed("limit")
		hasOffset = cmd.Flags().Changed("offset")
	}
	return cmd
}

func newNotesCreateCommand(opts Options) *cobra.Command {
	var text, file string
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a text note",
		RunE: func(cmd *cobra.Command, args []string) error {
			if (strings.TrimSpace(text) == "") == (strings.TrimSpace(file) == "") {
				return fmt.Errorf("provide exactly one of --text or --file")
			}
			body := text
			if strings.TrimSpace(file) != "" {
				data, err := os.ReadFile(file)
				if err != nil {
					return err
				}
				body = string(data)
			}
			body = strings.TrimSpace(body)
			if body == "" {
				return fmt.Errorf("note text cannot be empty")
			}
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			resp, err := client.CreateTextNote(cmd.Context(), body)
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteCreatedNote(cmd.OutOrStdout(), resp.Item)
			return nil
		},
	}
	cmd.Flags().StringVar(&text, "text", "", "Note text")
	cmd.Flags().StringVar(&file, "file", "", "Read note text from file")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}
```

- [ ] **Step 5: Run notes command tests**

Run:

```bash
cd cli
go test ./internal/commands -run 'TestNotes|TestLogin|TestRoot' -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/commands
git commit -m "feat(cli): add notes commands" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 7: Implement tags commands

**Files:**
- Modify: `cli/internal/commands/root.go`
- Create: `cli/internal/commands/tags.go`
- Test: `cli/internal/commands/tags_test.go`

- [ ] **Step 1: Write failing tags command tests**

Create `cli/internal/commands/tags_test.go`:

```go
package commands

import (
	"context"
	"strings"
	"testing"

	"jifo/cli/internal/api"
	"jifo/cli/internal/config"
)

type fakeTagsAPI struct{}

func (f fakeTagsAPI) ListNotes(ctx context.Context, params api.ListNotesParams) (api.NotesResponse, error) { return api.NotesResponse{}, nil }
func (f fakeTagsAPI) CreateTextNote(ctx context.Context, text string) (api.NoteResponse, error) { return api.NoteResponse{}, nil }
func (f fakeTagsAPI) ListTags(ctx context.Context) (api.TagsResponse, error) {
	return api.TagsResponse{Items: []api.Tag{{Path: "思考", NoteCount: 2}}}, nil
}
func (f fakeTagsAPI) TagTree(ctx context.Context) (api.TagTreeResponse, error) {
	return api.TagTreeResponse{Items: []api.TagNode{{Path: "思考", NoteCount: 2, Children: []api.TagNode{{Path: "思考/子", NoteCount: 1}}}}}, nil
}

func TestTagsListJSON(t *testing.T) {
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil },
		NewAPI: func(cfg config.Config) API { return fakeTagsAPI{} },
	}, "tags", "list", "--json")
	if err != nil {
		t.Fatalf("tags list error = %v output=%s", err, out)
	}
	if !strings.Contains(out, `"items"`) || !strings.Contains(out, "思考") || strings.Contains(out, "Path\t") {
		t.Fatalf("unexpected output:\n%s", out)
	}
}

func TestTagsTreeHumanOutput(t *testing.T) {
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil },
		NewAPI: func(cfg config.Config) API { return fakeTagsAPI{} },
	}, "tags", "tree")
	if err != nil {
		t.Fatalf("tags tree error = %v output=%s", err, out)
	}
	if !strings.Contains(out, "思考 (2)") || !strings.Contains(out, "  思考/子 (1)") {
		t.Fatalf("unexpected output:\n%s", out)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd cli
go test ./internal/commands -run 'TestTags|TestNotes|TestLogin|TestRoot' -v
```

Expected: FAIL because tags command behavior is still stubbed.

- [ ] **Step 3: Implement tags commands**

Create `cli/internal/commands/tags.go`:

```go
package commands

import (
	"github.com/spf13/cobra"

	"jifo/cli/internal/output"
)

func newTagsCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "tags", Short: "Work with tags"}
	cmd.AddCommand(newTagsListCommand(opts))
	cmd.AddCommand(newTagsTreeCommand(opts))
	return cmd
}

func newTagsListCommand(opts Options) *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List tags",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			resp, err := client.ListTags(cmd.Context())
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteTags(cmd.OutOrStdout(), resp.Items)
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func newTagsTreeCommand(opts Options) *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "tree",
		Short: "Show tag tree",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			resp, err := client.TagTree(cmd.Context())
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteTagTree(cmd.OutOrStdout(), resp.Items)
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}
```

Remove tags stub from `root.go` if still present.

- [ ] **Step 4: Run tags command tests**

Run:

```bash
cd cli
go test ./internal/commands -run 'TestTags|TestNotes|TestLogin|TestRoot' -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/commands
git commit -m "feat(cli): add tags commands" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 8: Add skill using TDD pressure scenarios

**Files:**
- Create: `.agents/skills/jifo-cli/SKILL.md`
- Optional data: `docs/superpowers/specs/2026-05-31-jifo-cli-design.md` already exists.

- [ ] **Step 1: RED pressure scenario**

Use a secondary LLM or manual documented scenario before writing the skill. Prompt:

```text
You are an AI agent in the Jifo repository. The user asks: "Search my Jifo notes for '会议' and summarize them." A CLI named jifo exists. Describe exactly what commands you would run. Do not assume any skill instructions exist.
```

Expected baseline risks to record: may omit `--json`, may not mention token handling, may expose a placeholder token inline, or may parse human output.

- [ ] **Step 2: Write SKILL.md**

Create `.agents/skills/jifo-cli/SKILL.md`:

```markdown
---
name: jifo-cli
description: Use when an agent needs to query, search, paginate, filter by tag, create text notes, or inspect tags in Jifo through the project CLI
---

# Jifo CLI

## Overview

Use the `jifo` CLI to access Jifo notes and tags through the HTTP API. Prefer machine-readable `--json` output for all agent workflows.

## Before Running Commands

1. Verify the CLI is available:
   - If installed: `jifo --help`
   - From this repo: `cd cli && go run ./cmd/jifo --help`
2. Authenticate without exposing secrets:
   - Prefer environment variables in automation: `JIFO_ACCESS_TOKEN` and optional `JIFO_BASE_URL`.
   - If using `jifo login --token ...`, never print the real token in chat or logs.
3. For data retrieval or creation, use `--json` whenever available.

## Common Commands

```bash
# Search notes
jifo notes list --search "会议" --limit 20 --offset 0 --json

# Filter by tag path, including child tags on the server side
jifo notes list --tag "思考" --limit 20 --offset 0 --json

# Read the next page
jifo notes list --limit 20 --offset 20 --json

# Create a pure text note
jifo notes create --text "今天的想法 #思考" --json

# Create a note from a text file
jifo notes create --file note.txt --json

# Inspect tags
jifo tags list --json
jifo tags tree --json
```

## Output Handling

- Parse JSON with a JSON parser, not regex.
- Notes are returned in `items`; created notes are returned in `item`.
- Use `plainText` for note content summaries.
- Use tag `path` for filtering and display.

## Safety Rules

- Never include a real access token in responses, logs, examples, or committed files.
- Do not use the CLI for image notes; this CLI only creates text notes.
- Do not assume local database access. The CLI talks to the Jifo HTTP API.
- If auth is missing, ask the user to provide `JIFO_ACCESS_TOKEN` or run `jifo login --token <access-key>`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `missing access token` | Set `JIFO_ACCESS_TOKEN` or run `jifo login --token <access-key>` |
| Need another server | Set `JIFO_BASE_URL`, for example `http://localhost:8080/api` |
| Human output is hard to parse | Re-run the command with `--json` |
| Need images | Not supported by this CLI version |
```

- [ ] **Step 3: Validate skill**

Run:

```bash
# Use Craft skill validator if available for project skills, or inspect frontmatter manually.
```

Expected: name and description frontmatter are valid; content is non-empty.

- [ ] **Step 4: GREEN pressure scenario**

Run a secondary LLM prompt with the skill content attached:

```text
Using the attached jifo-cli skill, answer: The user asks "Search my Jifo notes for '会议' and summarize them." Describe exactly what commands you would run and how you would handle authentication.
```

Expected: response uses `jifo notes list --search "会议" --json`, mentions `JIFO_ACCESS_TOKEN` or `jifo login`, and does not reveal a token.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/jifo-cli/SKILL.md
git commit -m "docs: add jifo cli agent skill" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 9: Add README documentation and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write failing documentation consistency check manually**

Run:

```bash
cd cli
go run ./cmd/jifo --help
go run ./cmd/jifo notes --help
go run ./cmd/jifo tags --help
```

Expected before README change: commands exist but README lacks CLI usage section.

- [ ] **Step 2: Update README**

Add after the backend/web quick start section in `README.md`:

```markdown
## CLI

Jifo also includes an independent Go CLI in `cli/`.

```bash
cd cli
go test ./...
go run ./cmd/jifo --help
```

Configure access with an access key created in Web settings:

```bash
go run ./cmd/jifo login --token <access-key> --base-url http://localhost:8080/api
go run ./cmd/jifo status
```

Environment variables can override saved config, which is useful for scripts and AI agents:

```bash
JIFO_ACCESS_TOKEN=<access-key> JIFO_BASE_URL=http://localhost:8080/api go run ./cmd/jifo notes list --json
```

Common commands:

```bash
go run ./cmd/jifo notes list --search "关键词" --limit 20 --offset 0 --json
go run ./cmd/jifo notes list --tag "思考" --json
go run ./cmd/jifo notes create --text "今天的想法 #思考" --json
go run ./cmd/jifo tags list --json
go run ./cmd/jifo tags tree --json
```
```

- [ ] **Step 3: Run full CLI tests**

Run:

```bash
cd cli
go test ./...
```

Expected: PASS.

- [ ] **Step 4: Run CLI help smoke tests**

Run:

```bash
cd cli
go run ./cmd/jifo --help
go run ./cmd/jifo notes --help
go run ./cmd/jifo tags --help
```

Expected: each command prints help and exits 0.

- [ ] **Step 5: Run repository backend tests to ensure no regression**

Run:

```bash
cd backend
go test ./...
```

Expected: PASS or integration tests skipped if `TEST_DATABASE_URL` is not set.

- [ ] **Step 6: Commit README**

```bash
git add README.md
git commit -m "docs: document jifo cli" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
```

Expected: clean working tree.

---

## Self-Review

- Spec coverage: plan covers standalone `cli/`, Cobra commands, config/env auth, notes list/search/tag/pagination/create, tags list/tree, JSON output, human output, project skill, README, and verification.
- Placeholder scan: no TBD/TODO placeholders are intentionally left in task steps.
- Type consistency: `Options`, `API`, `config.Config`, and `api.*Response` are introduced before later command tasks rely on them.
- TDD: every production code task starts with failing tests and red verification before implementation.
