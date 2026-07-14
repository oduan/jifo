package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func TestRecovererReturnsJSONError(t *testing.T) {
	h := RequestID(Recoverer(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})))
	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	resp := httptest.NewRecorder()
	h.ServeHTTP(resp, req)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
	if !strings.Contains(resp.Body.String(), "internal_error") {
		t.Fatalf("body = %s", resp.Body.String())
	}
}

func TestProxyResolverOnlyTrustsForwardedHeaderFromConfiguredProxy(t *testing.T) {
	resolver, err := NewProxyResolver([]string{"10.0.0.0/8"})
	if err != nil {
		t.Fatal(err)
	}
	h := resolver.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(ClientIPFromContext(r.Context())))
	}))

	trusted := httptest.NewRequest(http.MethodGet, "/", nil)
	trusted.RemoteAddr = "10.1.2.3:1234"
	trusted.Header.Set("X-Forwarded-For", "203.0.113.8")
	trustedResp := httptest.NewRecorder()
	h.ServeHTTP(trustedResp, trusted)
	if trustedResp.Body.String() != "203.0.113.8" {
		t.Fatalf("trusted client ip = %q", trustedResp.Body.String())
	}

	untrusted := httptest.NewRequest(http.MethodGet, "/", nil)
	untrusted.RemoteAddr = "192.0.2.10:1234"
	untrusted.Header.Set("X-Forwarded-For", "203.0.113.8")
	untrustedResp := httptest.NewRecorder()
	h.ServeHTTP(untrustedResp, untrusted)
	if untrustedResp.Body.String() != "192.0.2.10" {
		t.Fatalf("untrusted client ip = %q", untrustedResp.Body.String())
	}
}

func TestRateLimiterRejectsRequestsOverLimit(t *testing.T) {
	limiter := NewRateLimiter(2, time.Minute)
	h := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for i, want := range []int{http.StatusNoContent, http.StatusNoContent, http.StatusTooManyRequests} {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = "192.0.2.1:1234"
		resp := httptest.NewRecorder()
		h.ServeHTTP(resp, req)
		if resp.Code != want {
			t.Fatalf("request %d status = %d, want %d", i+1, resp.Code, want)
		}
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
