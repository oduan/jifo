package auth

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
	"jifo/backend/internal/platform/testutil"
)

type fakeHandlerService struct {
	registerResult *AuthResult
	registerErr    error
	loginResult    *AuthResult
	loginErr       error
	refreshResult  *AuthResult
	refreshErr     error
	logoutErr      error

	// lastRefreshToken 记录最近一次 Refresh 收到的令牌，用于断言请求体与 Cookie 的优先级。
	lastRefreshToken string
}

func (f *fakeHandlerService) Register(ctx context.Context, input RegisterInput) (*AuthResult, error) {
	if f.registerErr != nil {
		return nil, f.registerErr
	}
	if f.registerResult != nil {
		return f.registerResult, nil
	}
	return &AuthResult{AccessToken: "access-token", RefreshToken: "registered-refresh-token", User: User{ID: uuid.New(), Email: input.Email, Username: "u"}}, nil
}

func (f *fakeHandlerService) Login(ctx context.Context, input LoginInput) (*AuthResult, error) {
	if f.loginErr != nil {
		return nil, f.loginErr
	}
	if f.loginResult != nil {
		return f.loginResult, nil
	}
	return &AuthResult{AccessToken: "access-token", RefreshToken: "login-refresh-token", User: User{ID: uuid.New(), Email: input.Email, Username: "u"}}, nil
}

func (f *fakeHandlerService) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	f.lastRefreshToken = refreshToken
	if f.refreshErr != nil {
		return nil, f.refreshErr
	}
	if f.refreshResult != nil {
		return f.refreshResult, nil
	}
	return &AuthResult{AccessToken: "access-token-refreshed", RefreshToken: "rotated-refresh-token", User: User{ID: uuid.New(), Email: "a@example.com", Username: "u"}}, nil
}

func (f *fakeHandlerService) Logout(ctx context.Context, userID, sessionID uuid.UUID) error {
	return f.logoutErr
}

func authJSONRequest(t *testing.T, method, target string, body any) *http.Request {
	t.Helper()
	if body == nil {
		return httptest.NewRequest(method, target, nil)
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func findCookie(t *testing.T, resp *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range resp.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("cookie %q not found in Set-Cookie headers", name)
	return nil
}

func assertRefreshCookie(t *testing.T, cookie *http.Cookie, wantValue string, wantSecure bool) {
	t.Helper()
	if cookie.Value != wantValue {
		t.Fatalf("cookie value = %q, want %q", cookie.Value, wantValue)
	}
	if !cookie.HttpOnly {
		t.Fatal("refresh cookie must be HttpOnly")
	}
	if cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie SameSite = %v, want Strict", cookie.SameSite)
	}
	if cookie.Path != RefreshCookiePath {
		t.Fatalf("cookie Path = %q, want %q", cookie.Path, RefreshCookiePath)
	}
	if cookie.Secure != wantSecure {
		t.Fatalf("cookie Secure = %v, want %v", cookie.Secure, wantSecure)
	}
	if cookie.MaxAge != int(refreshCookieMaxAge.Seconds()) {
		t.Fatalf("cookie MaxAge = %d, want %d", cookie.MaxAge, int(refreshCookieMaxAge.Seconds()))
	}
}

func TestRegisterAndLoginSetRefreshCookie(t *testing.T) {
	svc := &fakeHandlerService{}
	handler := NewHandler(svc)

	registerResp := httptest.NewRecorder()
	handler.Register(registerResp, authJSONRequest(t, http.MethodPost, "/api/auth/register", map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev"}))
	if registerResp.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d", registerResp.Code, http.StatusCreated)
	}
	assertRefreshCookie(t, findCookie(t, registerResp, RefreshCookieName), "registered-refresh-token", false)

	loginResp := httptest.NewRecorder()
	handler.Login(loginResp, authJSONRequest(t, http.MethodPost, "/api/auth/login", map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev"}))
	if loginResp.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d", loginResp.Code, http.StatusOK)
	}
	assertRefreshCookie(t, findCookie(t, loginResp, RefreshCookieName), "login-refresh-token", false)

	// 失败响应不得下发 Cookie。
	failedHandler := NewHandler(&fakeHandlerService{loginErr: ErrInvalidCredentials})
	badLogin := httptest.NewRecorder()
	failedHandler.Login(badLogin, authJSONRequest(t, http.MethodPost, "/api/auth/login", map[string]any{"email": "a@example.com", "password": "p", "deviceCode": "dev"}))
	if badLogin.Code != http.StatusUnauthorized {
		t.Fatalf("failed login status = %d, want %d", badLogin.Code, http.StatusUnauthorized)
	}
	if len(badLogin.Result().Cookies()) != 0 {
		t.Fatalf("failed login must not set cookies, got %v", badLogin.Result().Cookies())
	}
}

func TestRefreshWithCookieRotatesAndRewritesCookie(t *testing.T) {
	svc := &fakeHandlerService{}
	handler := NewHandler(svc)

	// 空请求体（浏览器只带 Cookie 时）也能刷新。
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "cookie-refresh-token"})
	resp := httptest.NewRecorder()
	handler.Refresh(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("refresh status = %d body=%s, want %d", resp.Code, resp.Body.String(), http.StatusOK)
	}
	if svc.lastRefreshToken != "cookie-refresh-token" {
		t.Fatalf("service received token %q, want cookie value", svc.lastRefreshToken)
	}
	var payload authResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.RefreshToken != "rotated-refresh-token" {
		t.Fatalf("response refreshToken = %q, want rotated token", payload.RefreshToken)
	}
	// 轮换出的新 token 必须写回 Cookie：否则旧 cookie 重放会触发 reuse 检测撤销整条会话。
	assertRefreshCookie(t, findCookie(t, resp, RefreshCookieName), "rotated-refresh-token", false)
}

func TestRefreshBodyTokenTakesPrecedenceOverCookie(t *testing.T) {
	svc := &fakeHandlerService{}
	handler := NewHandler(svc)

	req := authJSONRequest(t, http.MethodPost, "/api/auth/refresh", map[string]any{"refreshToken": "body-refresh-token"})
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "cookie-refresh-token"})
	resp := httptest.NewRecorder()
	handler.Refresh(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("refresh status = %d body=%s, want %d", resp.Code, resp.Body.String(), http.StatusOK)
	}
	if svc.lastRefreshToken != "body-refresh-token" {
		t.Fatalf("service received token %q, want body token to win", svc.lastRefreshToken)
	}
	assertRefreshCookie(t, findCookie(t, resp, RefreshCookieName), "rotated-refresh-token", false)
}

func TestRefreshWithExpiredCookieReturnsUnauthorized(t *testing.T) {
	svc := &fakeHandlerService{refreshErr: ErrInvalidRefreshToken}
	handler := NewHandler(svc)

	// 浏览器场景：只有（已过期/失效的）Cookie，没有请求体 token。
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "expired-cookie-token"})
	resp := httptest.NewRecorder()
	handler.Refresh(resp, req)

	if svc.lastRefreshToken != "expired-cookie-token" {
		t.Fatalf("service received token %q, want cookie value", svc.lastRefreshToken)
	}

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("refresh status = %d, want %d", resp.Code, http.StatusUnauthorized)
	}
	var payload struct {
		Error httpx.ErrorBody `json:"error"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "invalid_refresh_token" {
		t.Fatalf("error code = %q, want invalid_refresh_token", payload.Error.Code)
	}
}

func TestRefreshWithoutAnyTokenReturnsBadRequest(t *testing.T) {
	svc := &fakeHandlerService{}
	handler := NewHandler(svc)

	// 既没有请求体 token 也没有 Cookie。
	resp := httptest.NewRecorder()
	handler.Refresh(resp, httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("refresh without tokens status = %d, want %d", resp.Code, http.StatusBadRequest)
	}

	// 非法 JSON 且没有 Cookie 时保持原有的 invalid json body 语义。
	badJSONResp := httptest.NewRecorder()
	handler.Refresh(badJSONResp, httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader("{not-json")))
	if badJSONResp.Code != http.StatusBadRequest {
		t.Fatalf("refresh with invalid json status = %d, want %d", badJSONResp.Code, http.StatusBadRequest)
	}
	if svc.lastRefreshToken != "" {
		t.Fatalf("service must not be called without tokens, got %q", svc.lastRefreshToken)
	}
}

func TestRefreshWithInvalidJSONStillUsesCookie(t *testing.T) {
	svc := &fakeHandlerService{}
	handler := NewHandler(svc)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader("{not-json"))
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "cookie-refresh-token"})
	resp := httptest.NewRecorder()
	handler.Refresh(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("refresh status = %d body=%s, want %d", resp.Code, resp.Body.String(), http.StatusOK)
	}
	if svc.lastRefreshToken != "cookie-refresh-token" {
		t.Fatalf("service received token %q, want cookie value", svc.lastRefreshToken)
	}
}

func TestLogoutClearsRefreshCookie(t *testing.T) {
	svc := &fakeHandlerService{}
	handler := NewHandler(svc)
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	sessionID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	// Logout 挂在 RequireAuth 之下，必须带 Bearer token 才能进入 handler。
	req.Header.Set("Authorization", "Bearer test-token")
	resp := httptest.NewRecorder()
	logout := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, sessionID, nil
	})(http.HandlerFunc(handler.Logout))
	logout.ServeHTTP(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d body=%s, want %d", resp.Code, resp.Body.String(), http.StatusNoContent)
	}
	cookie := findCookie(t, resp, RefreshCookieName)
	if cookie.Value != "" {
		t.Fatalf("cleared cookie value = %q, want empty", cookie.Value)
	}
	if cookie.MaxAge >= 0 {
		t.Fatalf("cleared cookie MaxAge = %d, want negative to delete the cookie", cookie.MaxAge)
	}
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != RefreshCookiePath {
		t.Fatalf("cleared cookie attributes = %+v, want same as set cookie", cookie)
	}
}

func TestRefreshCookieSecureAttribute(t *testing.T) {
	svc := &fakeHandlerService{}

	t.Run("TLS request adds Secure in development", func(t *testing.T) {
		handler := NewHandler(svc)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
		req.TLS = &tls.ConnectionState{}
		req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "cookie-refresh-token"})
		resp := httptest.NewRecorder()
		handler.Refresh(resp, req)
		if resp.Code != http.StatusOK {
			t.Fatalf("refresh status = %d, want %d", resp.Code, http.StatusOK)
		}
		assertRefreshCookie(t, findCookie(t, resp, RefreshCookieName), "rotated-refresh-token", true)
	})

	t.Run("production option adds Secure without TLS", func(t *testing.T) {
		handler := NewHandlerWithOptions(svc, HandlerOptions{SecureCookie: true})
		req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
		req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "cookie-refresh-token"})
		resp := httptest.NewRecorder()
		handler.Refresh(resp, req)
		if resp.Code != http.StatusOK {
			t.Fatalf("refresh status = %d, want %d", resp.Code, http.StatusOK)
		}
		assertRefreshCookie(t, findCookie(t, resp, RefreshCookieName), "rotated-refresh-token", true)
	})

	t.Run("plain development request omits Secure", func(t *testing.T) {
		handler := NewHandler(svc)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
		req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: "cookie-refresh-token"})
		resp := httptest.NewRecorder()
		handler.Refresh(resp, req)
		if resp.Code != http.StatusOK {
			t.Fatalf("refresh status = %d, want %d", resp.Code, http.StatusOK)
		}
		assertRefreshCookie(t, findCookie(t, resp, RefreshCookieName), "rotated-refresh-token", false)
	})
}

func TestRefreshCookieRotationPreventsReuseRevocation(t *testing.T) {
	// 用真实 Service 的 reuse 语义固定“轮换响应必须把新 token 写回 Cookie”：
	// 若实现忘记改写 Cookie，浏览器会持续重放旧 token，超出复用宽限期后
	// 触发 reuse 检测，整条会话被撤销（连最新 token 一起失效）。
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	realSvc, err := NewService(db, testAccessTokenSecret, time.Hour)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	registered, err := realSvc.Register(ctx, RegisterInput{Email: "cookie@example.com", Password: "cookie-password", DeviceCode: "device-cookie"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	handler := NewHandler(realSvc)

	// 第一次：带 Cookie 刷新成功，Cookie 被改写为轮换后的新 token。
	firstReq := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	firstReq.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: registered.RefreshToken})
	firstResp := httptest.NewRecorder()
	handler.Refresh(firstResp, firstReq)
	if firstResp.Code != http.StatusOK {
		t.Fatalf("first refresh status = %d body=%s, want %d", firstResp.Code, firstResp.Body.String(), http.StatusOK)
	}
	rotated := findCookie(t, firstResp, RefreshCookieName)
	if rotated.Value == registered.RefreshToken {
		t.Fatal("rotated cookie must carry the new token, not the old one")
	}

	// 第二次：浏览器只带改写后的新 Cookie 也能继续刷新，会话保持存活。
	secondReq := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	secondReq.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: rotated.Value})
	secondResp := httptest.NewRecorder()
	handler.Refresh(secondResp, secondReq)
	if secondResp.Code != http.StatusOK {
		t.Fatalf("second refresh status = %d body=%s, want %d", secondResp.Code, secondResp.Body.String(), http.StatusOK)
	}

	// 反例固定：旧 token 重放超出宽限期 → 401 且会话被撤销。
	// 只有轮换响应正确改写 Cookie，浏览器才不会走到这一步。
	if _, err := db.Exec(ctx, `
		UPDATE session_refresh_tokens
		SET reuse_until = now() - interval '1 second'
		WHERE token_hash = $1
	`, hashRefreshToken(registered.RefreshToken)); err != nil {
		t.Fatalf("expire reuse grace: %v", err)
	}
	replayReq := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	replayReq.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: registered.RefreshToken})
	replayResp := httptest.NewRecorder()
	handler.Refresh(replayResp, replayReq)
	if replayResp.Code != http.StatusUnauthorized {
		t.Fatalf("stale cookie replay status = %d body=%s, want %d", replayResp.Code, replayResp.Body.String(), http.StatusUnauthorized)
	}
	var revokedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT revoked_at FROM user_sessions WHERE user_id = $1`, registered.User.ID).Scan(&revokedAt); err != nil {
		t.Fatalf("query revoked_at: %v", err)
	}
	if revokedAt == nil {
		t.Fatal("stale cookie replay must revoke the session")
	}
}
