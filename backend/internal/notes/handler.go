package notes

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	Create(ctx context.Context, input CreateInput) (Note, error)
	List(ctx context.Context, filter ListFilter) ([]Note, error)
}

type Handler struct {
	svc HandlerService
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
}

type createNoteRequest struct {
	ClientID  string  `json:"clientId"`
	Content   Content `json:"content"`
	PlainText string  `json:"plainText"`
}

type noteDTO struct {
	ID        string     `json:"id"`
	ClientID  string     `json:"clientId"`
	PlainText string     `json:"plainText"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "notes service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}

	var req createNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return
	}
	req.ClientID = strings.TrimSpace(req.ClientID)
	if req.ClientID == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "clientId is required")
		return
	}

	note, err := h.svc.Create(r.Context(), CreateInput{UserID: userID, ClientID: req.ClientID, Content: req.Content, PlainText: req.PlainText})
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "create note failed")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"item": toNoteDTO(note)})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "notes service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	query := r.URL.Query()
	trash := parseBool(query.Get("trash"))
	limit, err := parseInt(query.Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid limit")
		return
	}
	offset, err := parseInt(query.Get("offset"))
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid offset")
		return
	}

	items, err := h.svc.List(r.Context(), ListFilter{
		UserID:  userID,
		Trash:   trash,
		Search:  query.Get("search"),
		TagPath: query.Get("tagPath"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "list notes failed")
		return
	}
	out := make([]noteDTO, 0, len(items))
	for _, item := range items {
		out = append(out, toNoteDTO(item))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
}

func toNoteDTO(note Note) noteDTO {
	return noteDTO{
		ID:        note.ID.String(),
		ClientID:  note.ClientID,
		PlainText: note.PlainText,
		DeletedAt: note.DeletedAt,
		CreatedAt: note.CreatedAt,
		UpdatedAt: note.UpdatedAt,
	}
}

func parseInt(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	return strconv.Atoi(raw)
}

func parseBool(raw string) bool {
	raw = strings.TrimSpace(strings.ToLower(raw))
	return raw == "1" || raw == "true" || raw == "yes"
}
