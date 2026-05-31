package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/accesskeys"
	"jifo/backend/internal/auth"
	"jifo/backend/internal/heatmap"
	"jifo/backend/internal/media"
	"jifo/backend/internal/notes"
	syncsvc "jifo/backend/internal/sync"
	"jifo/backend/internal/tags"
)

type fakeAuthService struct {
	userID uuid.UUID
}

func (f *fakeAuthService) Register(ctx context.Context, input auth.RegisterInput) (*auth.AuthResult, error) {
	return &auth.AuthResult{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
		User:         auth.User{ID: f.userID, Email: input.Email, Username: "u"},
	}, nil
}

func (f *fakeAuthService) Login(ctx context.Context, input auth.LoginInput) (*auth.AuthResult, error) {
	return &auth.AuthResult{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token-2",
		User:         auth.User{ID: f.userID, Email: input.Email, Username: "u"},
	}, nil
}

func (f *fakeAuthService) ValidateAccessToken(ctx context.Context, token string) (*auth.AccessTokenClaims, error) {
	if token != "access-token" {
		return nil, auth.ErrInvalidAccessToken
	}
	return &auth.AccessTokenClaims{UserID: f.userID, SessionID: uuid.MustParse("22222222-2222-2222-2222-222222222222")}, nil
}

type fakeAccessKeyService struct {
	userID uuid.UUID
}

func (f *fakeAccessKeyService) List(ctx context.Context, userID uuid.UUID) ([]accesskeys.AccessKey, error) {
	return []accesskeys.AccessKey{{ID: uuid.MustParse("66666666-6666-6666-6666-666666666666"), UserID: userID, Label: "CLI", MaskedKey: "jifo_abcd••••••••••vwxyz", CreatedAt: time.Date(2026, 5, 30, 1, 0, 0, 0, time.UTC)}}, nil
}

func (f *fakeAccessKeyService) Create(ctx context.Context, userID uuid.UUID, label string) (accesskeys.CreateResult, error) {
	item := accesskeys.AccessKey{ID: uuid.MustParse("66666666-6666-6666-6666-666666666666"), UserID: userID, Label: label, MaskedKey: "jifo_abcd••••••••••vwxyz", CreatedAt: time.Date(2026, 5, 30, 1, 0, 0, 0, time.UTC)}
	return accesskeys.CreateResult{AccessKey: item, Secret: "jifo_abcdefghijklmnopqrstuvwxyz"}, nil
}

func (f *fakeAccessKeyService) Validate(ctx context.Context, rawKey string) (accesskeys.Principal, error) {
	if rawKey != "api-key-token" {
		return accesskeys.Principal{}, accesskeys.ErrInvalidAccessKey
	}
	return accesskeys.Principal{UserID: f.userID, KeyID: uuid.MustParse("66666666-6666-6666-6666-666666666666")}, nil
}

type fakeNotesService struct{}

func (f *fakeNotesService) Create(ctx context.Context, input notes.CreateInput) (notes.Note, error) {
	return notes.Note{ID: uuid.MustParse("33333333-3333-3333-3333-333333333333"), UserID: input.UserID, ClientID: input.ClientID, Content: input.Content, PlainText: input.PlainText, Version: 1}, nil
}

func (f *fakeNotesService) List(ctx context.Context, filter notes.ListFilter) ([]notes.Note, error) {
	return []notes.Note{{ID: uuid.MustParse("33333333-3333-3333-3333-333333333333"), UserID: filter.UserID, ClientID: "c1", Content: notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "hello"}}}, PlainText: "hello", Version: 1}}, nil
}

func (f *fakeNotesService) Update(ctx context.Context, input notes.UpdateInput) (notes.Note, error) {
	return notes.Note{ID: input.NoteID, UserID: input.UserID, ClientID: "c1", Content: input.Content, PlainText: input.PlainText, Version: 2}, nil
}

func (f *fakeNotesService) MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (notes.Note, error) {
	deletedAt := time.Date(2026, 5, 30, 0, 0, 0, 0, time.UTC)
	return notes.Note{ID: noteID, UserID: userID, ClientID: "c1", PlainText: "deleted", DeletedAt: &deletedAt, Version: 2}, nil
}

func (f *fakeNotesService) Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (notes.Note, error) {
	return notes.Note{ID: noteID, UserID: userID, ClientID: "c1", PlainText: "restored", Version: 3}, nil
}

type fakeTagsService struct{}

func (f *fakeTagsService) List(ctx context.Context, userID uuid.UUID) ([]tags.Tag, error) {
	return []tags.Tag{{ID: uuid.MustParse("44444444-4444-4444-4444-444444444444"), Name: "项目", Path: "项目", Depth: 0, NoteCount: 1}}, nil
}

func (f *fakeTagsService) Tree(ctx context.Context, userID uuid.UUID) ([]tags.TreeNode, error) {
	return []tags.TreeNode{{ID: uuid.MustParse("44444444-4444-4444-4444-444444444444"), Name: "项目", Path: "项目", Depth: 0, NoteCount: 1}}, nil
}

type fakeHeatmapService struct{}

func (f *fakeHeatmapService) Aggregate(ctx context.Context, userID uuid.UUID, from time.Time, to time.Time) ([]heatmap.DayCount, error) {
	return []heatmap.DayCount{{Date: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), CreatedCount: 1, UpdatedCount: 2, TotalCount: 3}}, nil
}

type fakeSyncService struct{}

func (f *fakeSyncService) Push(ctx context.Context, userID uuid.UUID, sessionID *uuid.UUID, op syncsvc.Operation) (syncsvc.PushResult, error) {
	noteID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	return syncsvc.PushResult{Status: "created", NoteID: &noteID, Version: 1}, nil
}

func (f *fakeSyncService) Pull(ctx context.Context, userID uuid.UUID, cursor syncsvc.Cursor, limit int) (syncsvc.PullResult, error) {
	noteID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	return syncsvc.PullResult{Items: []syncsvc.PullItem{{NoteID: noteID, ClientID: "client-sync", Content: notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "sync note"}}}, PlainText: "sync note", Version: 1, UpdatedAt: time.Date(2026, 5, 30, 1, 0, 0, 0, time.UTC)}}}, nil
}

type fakeMediaService struct{}

type fakeMediaFile struct{ *strings.Reader }

func (f fakeMediaFile) Close() error { return nil }

func (f *fakeMediaService) List(ctx context.Context, userID uuid.UUID) ([]media.Asset, error) {
	return []media.Asset{{ID: uuid.MustParse("55555555-5555-5555-5555-555555555555"), UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: 3, Checksum: "checksum", CreatedAt: time.Date(2026, 5, 30, 1, 0, 0, 0, time.UTC)}}, nil
}

func (f *fakeMediaService) Get(ctx context.Context, userID uuid.UUID, assetID uuid.UUID) (media.Asset, error) {
	return media.Asset{ID: assetID, UserID: userID, Kind: "image", MIMEType: "image/png", SizeBytes: 3, Checksum: "checksum", CreatedAt: time.Date(2026, 5, 30, 1, 0, 0, 0, time.UTC)}, nil
}

func (f *fakeMediaService) Open(asset media.Asset) (media.File, error) {
	return fakeMediaFile{Reader: strings.NewReader("png")}, nil
}

func (f *fakeMediaService) Upload(ctx context.Context, input media.UploadInput) (media.Asset, error) {
	return media.Asset{ID: uuid.MustParse("55555555-5555-5555-5555-555555555555"), UserID: input.UserID, Kind: input.Kind, MIMEType: input.MIMEType, SizeBytes: input.SizeBytes, Checksum: "checksum", CreatedAt: time.Date(2026, 5, 30, 1, 0, 0, 0, time.UTC)}, nil
}

func TestRouterSmoke(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	router := NewRouter(Dependencies{
		Auth:       &fakeAuthService{userID: userID},
		AccessKeys: &fakeAccessKeyService{userID: userID},
		Notes:      &fakeNotesService{},
		Tags:       &fakeTagsService{},
		Heatmap:    &fakeHeatmapService{},
		Sync:       &fakeSyncService{},
		Media:      &fakeMediaService{},
	})

	registerBody := map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev"}
	registerResp := doJSON(t, router, http.MethodPost, "/api/auth/register", registerBody, "")
	if registerResp.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d", registerResp.Code, http.StatusCreated)
	}

	loginBody := map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev"}
	loginResp := doJSON(t, router, http.MethodPost, "/api/auth/login", loginBody, "")
	if loginResp.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d", loginResp.Code, http.StatusOK)
	}

	createBody := map[string]any{"clientId": "n1", "plainText": "#项目 hello", "content": map[string]any{"blocks": []map[string]any{{"type": "paragraph", "text": "#项目 hello"}}}}
	createResp := doJSON(t, router, http.MethodPost, "/api/notes", createBody, "access-token")
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create note status = %d, want %d", createResp.Code, http.StatusCreated)
	}

	listResp := doJSON(t, router, http.MethodGet, "/api/notes?search=hello&tagPath=项目&limit=10&offset=0", nil, "access-token")
	if listResp.Code != http.StatusOK {
		t.Fatalf("list notes status = %d, want %d", listResp.Code, http.StatusOK)
	}

	updateBody := map[string]any{"plainText": "#项目 updated", "content": map[string]any{"blocks": []map[string]any{{"type": "paragraph", "text": "#项目 updated"}}}}
	updateResp := doJSON(t, router, http.MethodPatch, "/api/notes/33333333-3333-3333-3333-333333333333", updateBody, "access-token")
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update note status = %d, want %d", updateResp.Code, http.StatusOK)
	}

	deleteResp := doJSON(t, router, http.MethodDelete, "/api/notes/33333333-3333-3333-3333-333333333333", nil, "access-token")
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("delete note status = %d, want %d", deleteResp.Code, http.StatusOK)
	}

	restoreResp := doJSON(t, router, http.MethodPost, "/api/notes/33333333-3333-3333-3333-333333333333/restore", nil, "access-token")
	if restoreResp.Code != http.StatusOK {
		t.Fatalf("restore note status = %d, want %d", restoreResp.Code, http.StatusOK)
	}

	treeResp := doJSON(t, router, http.MethodGet, "/api/tags/tree", nil, "access-token")
	if treeResp.Code != http.StatusOK {
		t.Fatalf("tags tree status = %d, want %d", treeResp.Code, http.StatusOK)
	}

	heatmapResp := doJSON(t, router, http.MethodGet, "/api/heatmap?from=2026-05-01&to=2026-05-07", nil, "access-token")
	if heatmapResp.Code != http.StatusOK {
		t.Fatalf("heatmap status = %d, want %d", heatmapResp.Code, http.StatusOK)
	}

	pushBody := map[string]any{"operations": []map[string]any{{"opId": "op-1", "entity": "note", "action": "create", "clientId": "client-sync", "payload": map[string]any{"blocks": []map[string]any{{"type": "paragraph", "text": "sync note"}}}}}}
	pushResp := doJSON(t, router, http.MethodPost, "/api/sync/push", pushBody, "access-token")
	if pushResp.Code != http.StatusOK {
		t.Fatalf("sync push status = %d, want %d", pushResp.Code, http.StatusOK)
	}

	pullResp := doJSON(t, router, http.MethodGet, "/api/sync/pull?limit=10", nil, "access-token")
	if pullResp.Code != http.StatusOK {
		t.Fatalf("sync pull status = %d, want %d", pullResp.Code, http.StatusOK)
	}

	mediaListResp := doJSON(t, router, http.MethodGet, "/api/media", nil, "access-token")
	if mediaListResp.Code != http.StatusOK {
		t.Fatalf("media list status = %d, want %d", mediaListResp.Code, http.StatusOK)
	}

	mediaGetResp := doJSON(t, router, http.MethodGet, "/api/media/55555555-5555-5555-5555-555555555555", nil, "access-token")
	if mediaGetResp.Code != http.StatusOK {
		t.Fatalf("media get status = %d, want %d", mediaGetResp.Code, http.StatusOK)
	}

	keyListResp := doJSON(t, router, http.MethodGet, "/api/settings/access-keys", nil, "access-token")
	if keyListResp.Code != http.StatusOK {
		t.Fatalf("access key list status = %d, want %d", keyListResp.Code, http.StatusOK)
	}

	keyCreateResp := doJSON(t, router, http.MethodPost, "/api/settings/access-keys", map[string]any{"label": "CLI"}, "access-token")
	if keyCreateResp.Code != http.StatusCreated {
		t.Fatalf("access key create status = %d, want %d", keyCreateResp.Code, http.StatusCreated)
	}

	keyAuthNotesResp := doJSON(t, router, http.MethodGet, "/api/notes", nil, "api-key-token")
	if keyAuthNotesResp.Code != http.StatusOK {
		t.Fatalf("access key auth notes status = %d, want %d", keyAuthNotesResp.Code, http.StatusOK)
	}

	keyAuthPushResp := doJSON(t, router, http.MethodPost, "/api/sync/push", pushBody, "api-key-token")
	if keyAuthPushResp.Code != http.StatusOK {
		t.Fatalf("access key auth sync push status = %d, want %d", keyAuthPushResp.Code, http.StatusOK)
	}
}

func TestAPINotFoundReturnsJSONError(t *testing.T) {
	router := NewRouter(Dependencies{})
	resp := doJSON(t, router, http.MethodGet, "/api/not-found", nil, "")
	if resp.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusNotFound)
	}
	var payload map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	errorObj, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error object missing: %#v", payload)
	}
	if errorObj["code"] == "" || errorObj["message"] == "" {
		t.Fatalf("invalid error payload: %#v", payload)
	}
}

func doJSON(t *testing.T, h http.Handler, method, target string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = httptest.NewRequest(method, target, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
