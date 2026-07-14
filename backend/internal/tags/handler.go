package tags

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	List(ctx context.Context, userID uuid.UUID) ([]Tag, error)
	Tree(ctx context.Context, userID uuid.UUID) ([]TreeNode, error)
	Rename(ctx context.Context, userID uuid.UUID, tagID uuid.UUID, path string) error
	Delete(ctx context.Context, userID uuid.UUID, tagID uuid.UUID, deleteNotes bool) error
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

type renameTagRequest struct {
	Path string `json:"path"`
}

func (h *Handler) Rename(w http.ResponseWriter, r *http.Request) {
	userID, tagID, ok := h.mutationContext(w, r)
	if !ok {
		return
	}
	var req renameTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return
	}
	if err := h.svc.Rename(r.Context(), userID, tagID, req.Path); err != nil {
		h.writeMutationError(w, r, err, "rename tag failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, tagID, ok := h.mutationContext(w, r)
	if !ok {
		return
	}
	deleteNotes := r.URL.Query().Get("deleteNotes") == "true"
	if err := h.svc.Delete(r.Context(), userID, tagID, deleteNotes); err != nil {
		h.writeMutationError(w, r, err, "delete tag failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) mutationContext(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "tags service not configured")
		return uuid.Nil, uuid.Nil, false
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return uuid.Nil, uuid.Nil, false
	}
	tagID, err := uuid.Parse(chi.URLParam(r, "tagID"))
	if err != nil || tagID == uuid.Nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid tag id")
		return uuid.Nil, uuid.Nil, false
	}
	return userID, tagID, true
}

func (h *Handler) writeMutationError(w http.ResponseWriter, r *http.Request, err error, message string) {
	if errors.Is(err, ErrTagNotFound) {
		httpx.WriteError(w, r, http.StatusNotFound, "tag_not_found", "tag not found")
		return
	}
	if errors.Is(err, ErrInvalidTagPath) {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid tag path")
		return
	}
	httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", message)
}
