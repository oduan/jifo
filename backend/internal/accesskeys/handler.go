package accesskeys

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	List(ctx context.Context, userID uuid.UUID) ([]AccessKey, error)
	Create(ctx context.Context, userID uuid.UUID, label string) (CreateResult, error)
	Revoke(ctx context.Context, userID uuid.UUID, keyID uuid.UUID) error
}

type Handler struct {
	svc HandlerService
}

type createAccessKeyRequest struct {
	Label string `json:"label"`
}

type accessKeyDTO struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	MaskedKey  string     `json:"maskedKey"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "access key service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	items, err := h.svc.List(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "list access keys failed")
		return
	}
	out := make([]accessKeyDTO, 0, len(items))
	for _, item := range items {
		out = append(out, toDTO(item))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "access key service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	var req createAccessKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return
	}
	result, err := h.svc.Create(r.Context(), userID, req.Label)
	if err != nil {
		if errors.Is(err, ErrInvalidLabel) {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "label is required")
			return
		}
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "create access key failed")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"item": toDTO(result.AccessKey), "secret": result.Secret})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "access key service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	keyID, err := uuid.Parse(chi.URLParam(r, "keyID"))
	if err != nil || keyID == uuid.Nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid access key id")
		return
	}
	if err := h.svc.Revoke(r.Context(), userID, keyID); err != nil {
		if errors.Is(err, ErrAccessKeyNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "access_key_not_found", "access key not found")
			return
		}
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "delete access key failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func toDTO(item AccessKey) accessKeyDTO {
	return accessKeyDTO{
		ID:         item.ID.String(),
		Label:      item.Label,
		MaskedKey:  item.MaskedKey,
		CreatedAt:  item.CreatedAt,
		LastUsedAt: item.LastUsedAt,
	}
}
