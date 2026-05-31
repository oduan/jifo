package accesskeys

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	List(ctx context.Context, userID uuid.UUID) ([]AccessKey, error)
	Create(ctx context.Context, userID uuid.UUID, label string) (CreateResult, error)
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

func toDTO(item AccessKey) accessKeyDTO {
	return accessKeyDTO{
		ID:         item.ID.String(),
		Label:      item.Label,
		MaskedKey:  item.MaskedKey,
		CreatedAt:  item.CreatedAt,
		LastUsedAt: item.LastUsedAt,
	}
}
