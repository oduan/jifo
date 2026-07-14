package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

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
	w.WriteHeader(http.StatusNoContent)
}

type Handler struct {
	svc HandlerService
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
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
	httpx.WriteJSON(w, http.StatusOK, toAuthResponse(result))
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "auth service not configured")
		return
	}
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return
	}
	req.RefreshToken = strings.TrimSpace(req.RefreshToken)
	if req.RefreshToken == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "refreshToken is required")
		return
	}
	result, err := h.svc.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidRefreshToken):
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid_refresh_token", "invalid refresh token")
		default:
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "refresh failed")
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAuthResponse(result))
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
