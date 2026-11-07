package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
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

func TestRateLimiterEvictsOldestEntryWhenFull(t *testing.T) {
	limiter := NewRateLimiter(5, time.Minute)
	limiter.maxEntries = 2
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }

	// 先后写入两个未过期 entry，key-a 的 reset 更早。
	if !limiter.allow("key-a") {
		t.Fatal("key-a should be allowed")
	}
	now = now.Add(time.Second)
	if !limiter.allow("key-b") {
		t.Fatal("key-b should be allowed")
	}

	// 满载且无过期项：新 key 应淘汰 reset 最早的 key-a 后被接纳。
	now = now.Add(time.Second)
	if !limiter.allow("key-c") {
		t.Fatal("key-c should be allowed after evicting the oldest entry")
	}
	if _, ok := limiter.entries["key-a"]; ok {
		t.Fatal("key-a should have been evicted")
	}
	if _, ok := limiter.entries["key-b"]; !ok {
		t.Fatal("key-b should be retained")
	}
	if _, ok := limiter.entries["key-c"]; !ok {
		t.Fatal("key-c should be present")
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

func TestProxyResolverWarnsThrottledWhenForwardedHeaderIgnored(t *testing.T) {
	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelWarn}))

	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	resolver, err := NewProxyResolver(nil)
	if err != nil {
		t.Fatal(err)
	}
	resolver.logger = logger
	resolver.warnNow = func() time.Time { return now }
	h := resolver.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	// 未配置 TRUSTED_PROXIES 且请求带 X-Forwarded-For：应告警，且一分钟内只告警一次。
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.8")
		resp := httptest.NewRecorder()
		h.ServeHTTP(resp, req)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("request %d status = %d, want %d", i+1, resp.Code, http.StatusNoContent)
		}
		now = now.Add(time.Second)
	}
	if got := strings.Count(logs.String(), "x_forwarded_for_ignored_without_trusted_proxies"); got != 1 {
		t.Fatalf("warnings within one minute = %d, want 1", got)
	}

	// 不带 X-Forwarded-For 的请求不应触发告警。
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	if got := strings.Count(logs.String(), "x_forwarded_for_ignored_without_trusted_proxies"); got != 1 {
		t.Fatalf("warnings after clean request = %d, want 1", got)
	}

	// 窗口过期后应再次告警。
	now = now.Add(forwardedWarningInterval)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.8")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if got := strings.Count(logs.String(), "x_forwarded_for_ignored_without_trusted_proxies"); got != 2 {
		t.Fatalf("warnings after window = %d, want 2", got)
	}
}

func TestProxyResolverDoesNotWarnWhenProxiesConfigured(t *testing.T) {
	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelWarn}))

	resolver, err := NewProxyResolver([]string{"10.0.0.0/8"})
	if err != nil {
		t.Fatal(err)
	}
	resolver.logger = logger
	h := resolver.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.1.2.3:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.8")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if logs.Len() != 0 {
		t.Fatalf("warnings = %q, want none when trusted proxies are configured", logs.String())
	}
}

func TestEmailRateLimiterLimitsPerEmailAndRestoresBody(t *testing.T) {
	limiter := NewRateLimiter(2, time.Minute)
	h := limiter.EmailMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 下游 handler 仍能完整解析请求体：证明中间件回填了等价 reader。
		var payload struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("downstream decode: %v", err)
		}
		if payload.Password != "secret" {
			t.Errorf("downstream password = %q, want full body preserved", payload.Password)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	send := func(email string) int {
		body, _ := json.Marshal(map[string]string{"email": email, "password": "secret"})
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
		resp := httptest.NewRecorder()
		h.ServeHTTP(resp, req)
		return resp.Code
	}

	// 同一邮箱：前两次放行，第三次 429（与 IP+path 桶并行的独立预算）。
	for i, want := range []int{http.StatusNoContent, http.StatusNoContent, http.StatusTooManyRequests} {
		if got := send("victim@example.com"); got != want {
			t.Fatalf("request %d status = %d, want %d", i+1, got, want)
		}
	}
	// 大小写变体命中同一个桶。
	if got := send("Victim@Example.com"); got != http.StatusTooManyRequests {
		t.Fatalf("case variant status = %d, want %d", got, http.StatusTooManyRequests)
	}
	// 不同邮箱有独立预算。
	if got := send("other@example.com"); got != http.StatusNoContent {
		t.Fatalf("other email status = %d, want %d", got, http.StatusNoContent)
	}
}

func TestEmailRateLimiterSkipsBucketWhenEmailUnavailable(t *testing.T) {
	limiter := NewRateLimiter(1, time.Minute)
	h := limiter.EmailMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	// 非法 JSON：不进 email 桶，且请求体原样传给下游（由下游按既有语义报 400）。
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader("not-json"))
		resp := httptest.NewRecorder()
		h.ServeHTTP(resp, req)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("invalid json request %d status = %d, want passthrough %d", i+1, resp.Code, http.StatusNoContent)
		}
	}

	// 空 body 同样直接放行。
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", http.NoBody)
	resp := httptest.NewRecorder()
	h.ServeHTTP(resp, req)
	if resp.Code != http.StatusNoContent {
		t.Fatalf("empty body status = %d, want passthrough", resp.Code)
	}
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
