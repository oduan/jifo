package accesskeys

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type fakeHandlerService struct {
	revokedUserID uuid.UUID
	revokedKeyID  uuid.UUID
	revokeErr     error
}

func (f *fakeHandlerService) List(ctx context.Context, userID uuid.UUID) ([]AccessKey, error) {
	return []AccessKey{{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), UserID: userID, Label: "CLI", MaskedKey: "jifo_abcd••••••••••vwxyz", CreatedAt: time.Date(2026, 5, 31, 1, 0, 0, 0, time.UTC)}}, nil
}

func (f *fakeHandlerService) Create(ctx context.Context, userID uuid.UUID, label string) (CreateResult, error) {
	return CreateResult{}, nil
}

func (f *fakeHandlerService) Revoke(ctx context.Context, userID uuid.UUID, keyID uuid.UUID) error {
	f.revokedUserID = userID
	f.revokedKeyID = keyID
	return f.revokeErr
}

func accessKeyDeleteRouter(svc *fakeHandlerService, userID uuid.UUID) http.Handler {
	h := NewHandler(svc)
	r := chi.NewRouter()
	r.Use(httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	}))
	r.Delete("/settings/access-keys/{keyID}", h.Delete)
	return r
}

func TestHandlerDeleteRevokesAccessKey(t *testing.T) {
	userID := uuid.New()
	keyID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	svc := &fakeHandlerService{}
	router := accessKeyDeleteRouter(svc, userID)
	req := httptest.NewRequest(http.MethodDelete, "/settings/access-keys/"+keyID.String(), nil)
	req.Header.Set("Authorization", "Bearer token")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s, want 204", rr.Code, rr.Body.String())
	}
	if svc.revokedUserID != userID || svc.revokedKeyID != keyID {
		t.Fatalf("revoked user/key = %s/%s, want %s/%s", svc.revokedUserID, svc.revokedKeyID, userID, keyID)
	}
}

func TestHandlerDeleteRejectsInvalidOrMissingAccessKey(t *testing.T) {
	userID := uuid.New()
	for _, tc := range []struct {
		name      string
		target    string
		revokeErr error
		want      int
	}{
		{name: "invalid uuid", target: "/settings/access-keys/not-a-uuid", want: http.StatusBadRequest},
		{name: "missing", target: "/settings/access-keys/11111111-1111-1111-1111-111111111111", revokeErr: ErrAccessKeyNotFound, want: http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakeHandlerService{revokeErr: tc.revokeErr}
			router := accessKeyDeleteRouter(svc, userID)
			req := httptest.NewRequest(http.MethodDelete, tc.target, nil)
			req.Header.Set("Authorization", "Bearer token")
			rr := httptest.NewRecorder()

			router.ServeHTTP(rr, req)

			if rr.Code != tc.want {
				t.Fatalf("status = %d body=%s, want %d", rr.Code, rr.Body.String(), tc.want)
			}
		})
	}
}
