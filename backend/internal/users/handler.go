package users

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"jifo/backend/internal/auth"
	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string) error
}

type Handler struct {
	service HandlerService
}

func NewHandler(service HandlerService) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if h.service == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "users service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	var request struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.CurrentPassword == "" || request.NewPassword == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "currentPassword and newPassword are required")
		return
	}
	if err := h.service.ChangePassword(r.Context(), userID, request.CurrentPassword, request.NewPassword); err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			httpx.WriteError(w, r, http.StatusUnauthorized, "invalid_credentials", "current password is incorrect")
		case errors.Is(err, auth.ErrInvalidPassword):
			httpx.WriteError(w, r, http.StatusBadRequest, "invalid_password", "password must be between 8 and 72 bytes")
		default:
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "change password failed")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
