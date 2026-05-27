package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestRequireAuthRejectsMissingBearerToken(t *testing.T) {
	mw := RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return uuid.Nil, uuid.Nil, errors.New("invalid")
	})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/notes", nil)
	resp := httptest.NewRecorder()
	h.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusUnauthorized)
	}
	var payload map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload["error"] == nil {
		t.Fatalf("error payload missing: %#v", payload)
	}
}

func TestRequireAuthDistinguishesUnauthorizedAndInternalErrors(t *testing.T) {
	t.Run("unauthorized", func(t *testing.T) {
		mw := RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
			return uuid.Nil, uuid.Nil, ErrUnauthorized
		})
		h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
		req := httptest.NewRequest(http.MethodGet, "/api/notes", nil)
		req.Header.Set("Authorization", "Bearer bad")
		resp := httptest.NewRecorder()
		h.ServeHTTP(resp, req)
		if resp.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", resp.Code, http.StatusUnauthorized)
		}
	})

	t.Run("internal", func(t *testing.T) {
		mw := RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
			return uuid.Nil, uuid.Nil, errors.New("database down")
		})
		h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
		req := httptest.NewRequest(http.MethodGet, "/api/notes", nil)
		req.Header.Set("Authorization", "Bearer maybe")
		resp := httptest.NewRecorder()
		h.ServeHTTP(resp, req)
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", resp.Code, http.StatusInternalServerError)
		}
	})
}

func TestRequireAuthInjectsUserIDToContext(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mw := RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.MustParse("22222222-2222-2222-2222-222222222222"), nil
	})

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := UserIDFromContext(r.Context())
		if !ok || got != userID {
			t.Fatalf("user id in context = %v, %v; want %s, true", got, ok, userID)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/notes", nil)
	req.Header.Set("Authorization", "Bearer good")
	resp := httptest.NewRecorder()
	h.ServeHTTP(resp, req)
	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusNoContent)
	}
}
