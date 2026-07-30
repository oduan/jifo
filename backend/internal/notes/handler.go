package notes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

const (
	defaultListLimit = 50
	maxListLimit     = 200
)

type HandlerService interface {
	Create(ctx context.Context, input CreateInput) (Note, error)
	List(ctx context.Context, filter ListFilter) (ListResult, error)
	CountActive(ctx context.Context, userID uuid.UUID) (int64, error)
	Update(ctx context.Context, input UpdateInput) (Note, error)
	MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error)
	Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error)
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

type updateNoteRequest struct {
	Content   Content `json:"content"`
	PlainText string  `json:"plainText"`
}

type noteDTO struct {
	ID        string     `json:"id"`
	ClientID  string     `json:"clientId"`
	Content   Content    `json:"content"`
	PlainText string     `json:"plainText"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	Version   int64      `json:"version"`
}

type pageDTO struct {
	Limit      int    `json:"limit"`
	Offset     int    `json:"offset"`
	HasMore    bool   `json:"hasMore"`
	NextCursor string `json:"nextCursor,omitempty"`
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
		if errors.Is(err, ErrMediaAssetUnavailable) {
			httpx.WriteError(w, r, http.StatusBadRequest, "media_unavailable", "referenced media is unavailable")
			return
		}
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
	if err != nil || limit < 0 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid limit")
		return
	}
	if limit == 0 {
		limit = defaultListLimit
	} else if limit > maxListLimit {
		limit = maxListLimit
	}
	offset, err := parseInt(query.Get("offset"))
	if err != nil || offset < 0 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid offset")
		return
	}
	cursorCreatedAt, cursorID, err := parseCursor(query.Get("cursor"))
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid cursor")
		return
	}

	result, err := h.svc.List(r.Context(), ListFilter{
		UserID:          userID,
		Trash:           trash,
		Search:          query.Get("search"),
		TagPath:         query.Get("tagPath"),
		Limit:           limit,
		Offset:          offset,
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        cursorID,
	})
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "list notes failed")
		return
	}
	out := make([]noteDTO, 0, len(result.Items))
	for _, item := range result.Items {
		out = append(out, toNoteDTO(item))
	}
	nextCursor := ""
	if result.HasMore && len(result.Items) > 0 {
		last := result.Items[len(result.Items)-1]
		nextCursor = encodeCursor(last.CreatedAt, last.ID)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out, "page": pageDTO{Limit: limit, Offset: offset, HasMore: result.HasMore, NextCursor: nextCursor}})
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "notes service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	total, err := h.svc.CountActive(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "count notes failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"total": total})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "notes service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	noteID, ok := noteIDParam(w, r)
	if !ok {
		return
	}
	var req updateNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return
	}
	note, err := h.svc.Update(r.Context(), UpdateInput{UserID: userID, NoteID: noteID, Content: req.Content, PlainText: req.PlainText})
	if err != nil {
		writeMutationError(w, r, err, "update note failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"item": toNoteDTO(note)})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "notes service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	noteID, ok := noteIDParam(w, r)
	if !ok {
		return
	}
	note, err := h.svc.MoveToTrash(r.Context(), userID, noteID)
	if err != nil {
		writeMutationError(w, r, err, "delete note failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"item": toNoteDTO(note)})
}

func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "notes service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	noteID, ok := noteIDParam(w, r)
	if !ok {
		return
	}
	note, err := h.svc.Restore(r.Context(), userID, noteID)
	if err != nil {
		writeMutationError(w, r, err, "restore note failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"item": toNoteDTO(note)})
}

func noteIDParam(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	noteID, err := uuid.Parse(chi.URLParam(r, "noteID"))
	if err != nil || noteID == uuid.Nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid note id")
		return uuid.Nil, false
	}
	return noteID, true
}

func writeMutationError(w http.ResponseWriter, r *http.Request, err error, message string) {
	if errors.Is(err, ErrNoteNotFound) {
		httpx.WriteError(w, r, http.StatusNotFound, "note_not_found", "note not found")
		return
	}
	if errors.Is(err, ErrMediaAssetUnavailable) {
		httpx.WriteError(w, r, http.StatusBadRequest, "media_unavailable", "referenced media is unavailable")
		return
	}
	httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", message)
}

func toNoteDTO(note Note) noteDTO {
	return noteDTO{
		ID:        note.ID.String(),
		ClientID:  note.ClientID,
		Content:   note.Content,
		PlainText: note.PlainText,
		DeletedAt: note.DeletedAt,
		CreatedAt: note.CreatedAt,
		UpdatedAt: note.UpdatedAt,
		Version:   note.Version,
	}
}

func parseInt(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	return strconv.Atoi(raw)
}

// encodeCursor 将 (createdAt, id) 编码为 base64 的 "RFC3339Nano,uuid" 游标。
func encodeCursor(createdAt time.Time, id uuid.UUID) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "," + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// parseCursor 解析 base64 游标，空字符串表示无游标（返回 nil,nil,nil）。
func parseCursor(raw string) (*time.Time, *uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, nil, err
	}
	parts := strings.SplitN(string(decoded), ",", 2)
	if len(parts) != 2 {
		return nil, nil, errors.New("invalid cursor format")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, nil, err
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, nil, err
	}
	return &createdAt, &id, nil
}

func parseBool(raw string) bool {
	raw = strings.TrimSpace(strings.ToLower(raw))
	return raw == "1" || raw == "true" || raw == "yes"
}
