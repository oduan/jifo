package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

const (
	// RefreshCookieName 是刷新令牌 HttpOnly Cookie 的名称。
	// Cookie 值就是 refresh token 本体，与请求体里的 refreshToken 同权，
	// 复用 Service.Refresh 既有的轮换/撤销逻辑，不引入新的存储。
	RefreshCookieName = "jifo_refresh_token"
	// RefreshCookiePath 限定 Cookie 只随 /api/auth 下的请求发送。
	// web 前端与 API 同源部署（nginx 把 /api 反代到本服务），浏览器看到的路径
	// 与这里的路由一致，因此 /api/auth 即可覆盖 register/login/refresh/logout。
	RefreshCookiePath = "/api/auth"
	// refreshCookieMaxAge 与 user_sessions 的 30 天滑动过期（service.go）对齐；
	// 每次刷新轮换都会重设 Cookie，持续使用的会话不会被浏览器提前丢弃。
	refreshCookieMaxAge = 30 * 24 * time.Hour
)

// HandlerOptions 控制 Handler 的 Cookie 行为。
type HandlerOptions struct {
	// SecureCookie 表示部署环境是 production（APP_ENV=production）。
	// 生产环境 TLS 通常由 nginx 反代终止，后端看不到 r.TLS，因此需要显式声明。
	SecureCookie bool
}

type HandlerService interface {
	Register(ctx context.Context, input RegisterInput) (*AuthResult, error)
	Login(ctx context.Context, input LoginInput) (*AuthResult, error)
	Refresh(ctx context.Context, refreshToken string) (*AuthResult, error)
	Logout(ctx context.Context, userID, sessionID uuid.UUID) error
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "auth service not configured")
		return
	}
	userID, userOK := httpx.UserIDFromContext(r.Context())
	sessionID, sessionOK := httpx.SessionIDFromContext(r.Context())
	if !userOK || !sessionOK || sessionID == uuid.Nil {
		httpx.WriteError(w, r, http.StatusForbidden, "user_session_required", "a user session is required")
		return
	}
	if err := h.svc.Logout(r.Context(), userID, sessionID); err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "logout failed")
		return
	}
	// 撤销会话成功后同步清掉浏览器侧的刷新令牌 Cookie。
	h.clearRefreshCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

type Handler struct {
	svc          HandlerService
	secureCookie bool
}

func NewHandler(svc HandlerService) *Handler {
	return NewHandlerWithOptions(svc, HandlerOptions{})
}

func NewHandlerWithOptions(svc HandlerService, options HandlerOptions) *Handler {
	return &Handler{svc: svc, secureCookie: options.SecureCookie}
}

type authRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	Username   string `json:"username"`
	DeviceCode string `json:"deviceCode"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type authResponse struct {
	AccessToken  string  `json:"accessToken"`
	RefreshToken string  `json:"refreshToken"`
	User         UserDTO `json:"user"`
}

type UserDTO struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "auth service not configured")
		return
	}
	input, ok := decodeAuthRequest(w, r)
	if !ok {
		return
	}
	result, err := h.svc.Register(r.Context(), RegisterInput(input))
	if err != nil {
		switch {
		case errors.Is(err, ErrEmailAlreadyExists):
			httpx.WriteError(w, r, http.StatusConflict, "email_exists", "email already exists")
		case errors.Is(err, ErrInvalidPassword):
			httpx.WriteError(w, r, http.StatusBadRequest, "invalid_password", "password must be between 8 and 72 bytes")
		default:
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "register failed")
		}
		return
	}
	h.setRefreshCookie(w, r, result.RefreshToken)
	httpx.WriteJSON(w, http.StatusCreated, toAuthResponse(result))
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "auth service not configured")
		return
	}
	input, ok := decodeAuthRequest(w, r)
	if !ok {
		return
	}
	result, err := h.svc.Login(r.Context(), LoginInput{Email: input.Email, Password: input.Password, DeviceCode: input.DeviceCode})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredentials):
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid_credentials", "invalid credentials")
		default:
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "login failed")
		}
		return
	}
	h.setRefreshCookie(w, r, result.RefreshToken)
	httpx.WriteJSON(w, http.StatusOK, toAuthResponse(result))
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "auth service not configured")
		return
	}
	var req refreshRequest
	bodyInvalid := false
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			// 请求体不是合法 JSON：若带了 Cookie 仍然允许用 Cookie 刷新，
			// 完全没有凭证时再按原有语义返回 400。
			bodyInvalid = true
		}
	}
	bodyToken := strings.TrimSpace(req.RefreshToken)
	cookieToken := h.refreshTokenFromCookie(r)
	if bodyToken == "" && cookieToken == "" {
		if bodyInvalid {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		} else {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "refreshToken is required")
		}
		return
	}
	// 请求体里的 refreshToken 优先（兼容 Android 与既有调用方），没有时回退到 Cookie。
	token := bodyToken
	if token == "" {
		token = cookieToken
	}
	result, err := h.svc.Refresh(r.Context(), token)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidRefreshToken):
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "invalid refresh token")
		default:
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "refresh failed")
		}
		return
	}
	// 轮换出的新 token 必须立刻写回 Cookie：否则浏览器下次仍携带旧 cookie，
	// 旧 token 一旦超出复用宽限期会触发 reuse 检测，整条会话被撤销。
	h.setRefreshCookie(w, r, result.RefreshToken)
	httpx.WriteJSON(w, http.StatusOK, toAuthResponse(result))
}

// refreshTokenFromCookie 读取 Cookie 里的刷新令牌；无 Cookie 或值为空时返回空串。
func (h *Handler) refreshTokenFromCookie(r *http.Request) string {
	cookie, err := r.Cookie(RefreshCookieName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}

// cookieSecure 决定是否给 Cookie 加 Secure 属性：
// production 环境（APP_ENV=production，TLS 由 nginx 反代终止，后端看不到 r.TLS）一律加；
// 开发环境下仅当请求本身走 TLS 时才加，便于本地 http 调试。
func (h *Handler) cookieSecure(r *http.Request) bool {
	return h.secureCookie || r.TLS != nil
}

// setRefreshCookie 把刷新令牌写进 HttpOnly Cookie（值与请求体中的 refreshToken 完全一致）。
func (h *Handler) setRefreshCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     RefreshCookieName,
		Value:    token,
		Path:     RefreshCookiePath,
		MaxAge:   int(refreshCookieMaxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   h.cookieSecure(r),
	})
}

// clearRefreshCookie 让浏览器立刻删除刷新令牌 Cookie（logout）。
func (h *Handler) clearRefreshCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     RefreshCookieName,
		Value:    "",
		Path:     RefreshCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   h.cookieSecure(r),
	})
}

func decodeAuthRequest(w http.ResponseWriter, r *http.Request) (RegisterInput, bool) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return RegisterInput{}, false
	}
	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)
	req.DeviceCode = strings.TrimSpace(req.DeviceCode)
	if req.Email == "" || req.Password == "" || req.DeviceCode == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "email, password, deviceCode are required")
		return RegisterInput{}, false
	}
	return RegisterInput{Email: req.Email, Password: req.Password, Username: strings.TrimSpace(req.Username), DeviceCode: req.DeviceCode}, true
}

func toAuthResponse(result *AuthResult) authResponse {
	return authResponse{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		User:         UserDTO{ID: result.User.ID.String(), Email: result.User.Email, Username: result.User.Username},
	}
}
