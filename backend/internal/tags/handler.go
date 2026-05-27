package tags

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	List(ctx context.Context, userID uuid.UUID) ([]Tag, error)
	Tree(ctx context.Context, userID uuid.UUID) ([]TreeNode, error)
}

type Handler struct {
	svc HandlerService
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "tags service not configured")
		return
	}
	tags, err := h.svc.List(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "list tags failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": tags})
}

func (h *Handler) Tree(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "tags service not configured")
		return
	}
	nodes, err := h.svc.Tree(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "tags tree failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": nodes})
}
