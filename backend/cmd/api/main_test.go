package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/auth"
	"jifo/backend/internal/heatmap"
	"jifo/backend/internal/notes"
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

type fakeNotesService struct{}

func (f *fakeNotesService) Create(ctx context.Context, input notes.CreateInput) (notes.Note, error) {
	return notes.Note{ID: uuid.MustParse("33333333-3333-3333-3333-333333333333"), UserID: input.UserID, ClientID: input.ClientID, PlainText: input.PlainText}, nil
}

func (f *fakeNotesService) List(ctx context.Context, filter notes.ListFilter) ([]notes.Note, error) {
	return []notes.Note{{ID: uuid.MustParse("33333333-3333-3333-3333-333333333333"), UserID: filter.UserID, ClientID: "c1", PlainText: "hello"}}, nil
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

func TestRouterSmoke(t *testing.T) {
	router := NewRouter(Dependencies{
		Auth:    &fakeAuthService{userID: uuid.MustParse("11111111-1111-1111-1111-111111111111")},
		Notes:   &fakeNotesService{},
		Tags:    &fakeTagsService{},
		Heatmap: &fakeHeatmapService{},
	})

	registerBody := map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev", "deviceName": "mac"}
	registerResp := doJSON(t, router, http.MethodPost, "/api/auth/register", registerBody, "")
	if registerResp.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d", registerResp.Code, http.StatusCreated)
	}

	loginBody := map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev", "deviceName": "mac"}
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

	treeResp := doJSON(t, router, http.MethodGet, "/api/tags/tree", nil, "access-token")
	if treeResp.Code != http.StatusOK {
		t.Fatalf("tags tree status = %d, want %d", treeResp.Code, http.StatusOK)
	}

	heatmapResp := doJSON(t, router, http.MethodGet, "/api/heatmap?from=2026-05-01&to=2026-05-07", nil, "access-token")
	if heatmapResp.Code != http.StatusOK {
		t.Fatalf("heatmap status = %d, want %d", heatmapResp.Code, http.StatusOK)
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
