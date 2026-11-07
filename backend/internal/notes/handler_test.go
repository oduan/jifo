package notes

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type fakeHandlerService struct {
	filter      ListFilter
	countUserID uuid.UUID

	createInput     CreateInput
	createNote      Note
	createDuplicate bool
	createErr       error

	updateInput UpdateInput
	updateNote  Note
	updateErr   error
}

func (f *fakeHandlerService) Create(ctx context.Context, input CreateInput) (Note, bool, error) {
	f.createInput = input
	return f.createNote, f.createDuplicate, f.createErr
}

func (f *fakeHandlerService) List(ctx context.Context, filter ListFilter) (ListResult, error) {
	f.filter = filter
	return ListResult{
		Items: []Note{{
			ID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			UserID:    filter.UserID,
			ClientID:  "c1",
			PlainText: "hello",
			CreatedAt: time.Date(2026, 5, 31, 1, 0, 0, 0, time.UTC),
			UpdatedAt: time.Date(2026, 5, 31, 1, 0, 0, 0, time.UTC),
			Version:   1,
		}},
		HasMore: true,
	}, nil
}

func (f *fakeHandlerService) CountActive(ctx context.Context, userID uuid.UUID) (int64, error) {
	f.countUserID = userID
	return 42, nil
}

func (f *fakeHandlerService) Update(ctx context.Context, input UpdateInput) (Note, error) {
	f.updateInput = input
	return f.updateNote, f.updateErr
}

func (f *fakeHandlerService) MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error) {
	return Note{}, nil
}

func (f *fakeHandlerService) Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error) {
	return Note{}, nil
}

func authenticatedRequest(target string, userID uuid.UUID) (*httptest.ResponseRecorder, *http.Request) {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()
	return rr, req
}

func serveAuthenticatedList(h *Handler, rr *httptest.ResponseRecorder, req *http.Request, userID uuid.UUID) {
	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(h.List))
	handler.ServeHTTP(rr, req)
}

func serveAuthenticatedCreate(h *Handler, rr *httptest.ResponseRecorder, req *http.Request, userID uuid.UUID) {
	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(h.Create))
	handler.ServeHTTP(rr, req)
}

func serveAuthenticatedUpdate(h *Handler, rr *httptest.ResponseRecorder, req *http.Request, userID uuid.UUID) {
	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(h.Update))
	handler.ServeHTTP(rr, req)
}

// jsonBodyRequest 构造带 JSON body 的请求；noteID 非零时注入 chi 路由参数，
// 供 Update 等 {noteID} 路由的 handler 使用。
func jsonBodyRequest(t *testing.T, method, target string, noteID uuid.UUID, body any) *http.Request {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	if noteID != uuid.Nil {
		routeCtx := chi.NewRouteContext()
		routeCtx.URLParams.Add("noteID", noteID.String())
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	}
	return req
}

func serveAuthenticatedStats(h *Handler, rr *httptest.ResponseRecorder, req *http.Request, userID uuid.UUID) {
	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(h.Stats))
	handler.ServeHTTP(rr, req)
}

func TestHandlerListReturnsPageMetadata(t *testing.T) {
	userID := uuid.New()
	svc := &fakeHandlerService{}
	h := NewHandler(svc)
	rr, req := authenticatedRequest("/notes?search=hi&tagPath=工作&limit=20&offset=40", userID)

	serveAuthenticatedList(h, rr, req, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if svc.filter.UserID != userID || svc.filter.Search != "hi" || svc.filter.TagPath != "工作" || svc.filter.Limit != 20 || svc.filter.Offset != 40 {
		t.Fatalf("filter = %+v", svc.filter)
	}
	var body struct {
		Items []noteDTO `json:"items"`
		Page  struct {
			Limit   int  `json:"limit"`
			Offset  int  `json:"offset"`
			HasMore bool `json:"hasMore"`
		} `json:"page"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Items) != 1 || body.Page.Limit != 20 || body.Page.Offset != 40 || !body.Page.HasMore {
		t.Fatalf("body = %+v", body)
	}
}

func TestHandlerStatsReturnsTotalActiveNotes(t *testing.T) {
	userID := uuid.New()
	svc := &fakeHandlerService{}
	h := NewHandler(svc)
	rr, req := authenticatedRequest("/notes/stats", userID)

	serveAuthenticatedStats(h, rr, req, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if svc.countUserID != userID {
		t.Fatalf("count userID = %s, want %s", svc.countUserID, userID)
	}
	var body struct {
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Total != 42 {
		t.Fatalf("total = %d, want 42", body.Total)
	}
}

func TestHandlerListRejectsNegativePagination(t *testing.T) {
	h := NewHandler(&fakeHandlerService{})
	for _, target := range []string{"/notes?limit=-1", "/notes?offset=-1"} {
		rr, req := authenticatedRequest(target, uuid.New())
		serveAuthenticatedList(h, rr, req, uuid.New())
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", target, rr.Code)
		}
	}
}

func TestHandlerListClampsAndDefaultsLimit(t *testing.T) {
	tests := []struct {
		target    string
		wantLimit int
	}{
		{target: "/notes", wantLimit: defaultListLimit},
		{target: "/notes?limit=0", wantLimit: defaultListLimit},
		{target: "/notes?limit=1000", wantLimit: maxListLimit},
		{target: "/notes?limit=200", wantLimit: maxListLimit},
		{target: "/notes?limit=25", wantLimit: 25},
	}
	for _, tt := range tests {
		svc := &fakeHandlerService{}
		h := NewHandler(svc)
		rr, req := authenticatedRequest(tt.target, uuid.New())
		serveAuthenticatedList(h, rr, req, uuid.New())
		if rr.Code != http.StatusOK {
			t.Fatalf("%s status = %d body=%s", tt.target, rr.Code, rr.Body.String())
		}
		if svc.filter.Limit != tt.wantLimit {
			t.Fatalf("%s filter.Limit = %d, want %d", tt.target, svc.filter.Limit, tt.wantLimit)
		}
	}
}

func TestHandlerCreateReturns201WithoutStatusWhenNoteIsNew(t *testing.T) {
	userID := uuid.New()
	created := Note{
		ID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		UserID:    userID,
		ClientID:  "new-1",
		PlainText: "hello",
		Version:   1,
	}
	svc := &fakeHandlerService{createNote: created}
	h := NewHandler(svc)

	req := jsonBodyRequest(t, http.MethodPost, "/api/notes", uuid.Nil, map[string]any{"clientId": "new-1", "plainText": "hello"})
	rr := httptest.NewRecorder()
	serveAuthenticatedCreate(h, rr, req, userID)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusCreated)
	}
	var body struct {
		Status string  `json:"status"`
		Item   noteDTO `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "" {
		t.Fatalf("status = %q, want empty for fresh create", body.Status)
	}
	if body.Item.ID != created.ID.String() {
		t.Fatalf("item id = %q, want %q", body.Item.ID, created.ID.String())
	}
	if svc.createInput.UserID != userID || svc.createInput.ClientID != "new-1" {
		t.Fatalf("create input = %+v", svc.createInput)
	}
}

func TestHandlerCreateReturnsDuplicateSemanticsOnClientIDRetry(t *testing.T) {
	userID := uuid.New()
	existing := Note{
		ID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		UserID:    userID,
		ClientID:  "retry-1",
		PlainText: "first",
		Version:   3,
	}
	svc := &fakeHandlerService{createNote: existing, createDuplicate: true}
	h := NewHandler(svc)

	req := jsonBodyRequest(t, http.MethodPost, "/api/notes", uuid.Nil, map[string]any{"clientId": "retry-1", "plainText": "first"})
	rr := httptest.NewRecorder()
	serveAuthenticatedCreate(h, rr, req, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusOK)
	}
	var body struct {
		Status string  `json:"status"`
		Item   noteDTO `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "duplicate" {
		t.Fatalf("status = %q, want duplicate", body.Status)
	}
	if body.Item.ID != existing.ID.String() || body.Item.Version != existing.Version {
		t.Fatalf("item = %+v, want existing note %s v%d", body.Item, existing.ID, existing.Version)
	}
}

func TestHandlerUpdatePassesOptionalBaseVersionToService(t *testing.T) {
	userID := uuid.New()
	noteID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	svc := &fakeHandlerService{updateNote: Note{ID: noteID, UserID: userID, PlainText: "updated", Version: 8}}
	h := NewHandler(svc)

	req := jsonBodyRequest(t, http.MethodPatch, "/api/notes/"+noteID.String(), noteID, map[string]any{"plainText": "updated", "baseVersion": 7})
	rr := httptest.NewRecorder()
	serveAuthenticatedUpdate(h, rr, req, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusOK)
	}
	if svc.updateInput.BaseVersion == nil || *svc.updateInput.BaseVersion != 7 {
		t.Fatalf("base version = %v, want 7", svc.updateInput.BaseVersion)
	}
	if svc.updateInput.NoteID != noteID || svc.updateInput.UserID != userID {
		t.Fatalf("update input = %+v", svc.updateInput)
	}
}

func TestHandlerUpdateWithoutBaseVersionKeepsUnconditionalOverwrite(t *testing.T) {
	userID := uuid.New()
	noteID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	svc := &fakeHandlerService{updateNote: Note{ID: noteID, UserID: userID, PlainText: "updated", Version: 2}}
	h := NewHandler(svc)

	req := jsonBodyRequest(t, http.MethodPatch, "/api/notes/"+noteID.String(), noteID, map[string]any{"plainText": "updated"})
	rr := httptest.NewRecorder()
	serveAuthenticatedUpdate(h, rr, req, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusOK)
	}
	if svc.updateInput.BaseVersion != nil {
		t.Fatalf("base version = %v, want nil when request omits baseVersion", svc.updateInput.BaseVersion)
	}
}

func TestHandlerUpdateReturns409VersionConflictOnStaleBaseVersion(t *testing.T) {
	userID := uuid.New()
	noteID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	svc := &fakeHandlerService{updateErr: ErrVersionConflict}
	h := NewHandler(svc)

	req := jsonBodyRequest(t, http.MethodPatch, "/api/notes/"+noteID.String(), noteID, map[string]any{"plainText": "updated", "baseVersion": 1})
	rr := httptest.NewRecorder()
	serveAuthenticatedUpdate(h, rr, req, userID)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusConflict)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != "version_conflict" {
		t.Fatalf("error code = %q, want version_conflict", body.Error.Code)
	}
}
