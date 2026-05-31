package notes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type fakeHandlerService struct {
	filter      ListFilter
	countUserID uuid.UUID
}

func (f *fakeHandlerService) Create(ctx context.Context, input CreateInput) (Note, error) {
	return Note{}, nil
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
	return Note{}, nil
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
