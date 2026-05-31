package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	Push(ctx context.Context, userID uuid.UUID, sessionID *uuid.UUID, op Operation) (PushResult, error)
	Pull(ctx context.Context, userID uuid.UUID, cursor Cursor, limit int) (PullResult, error)
}

type Handler struct {
	svc HandlerService
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(mux interface {
	Post(pattern string, handlerFn http.HandlerFunc)
	Get(pattern string, handlerFn http.HandlerFunc)
}) {
	mux.Post("/sync/push", h.Push)
	mux.Get("/sync/pull", h.Pull)
	mux.Post("/sync/pull", h.Pull)
}

type pushRequest struct {
	Operations []operationRequest `json:"operations"`
}

type operationRequest struct {
	OpID        string           `json:"opId"`
	Entity      string           `json:"entity"`
	Action      string           `json:"action"`
	ClientID    string           `json:"clientId"`
	NoteID      string           `json:"noteId"`
	EntityID    string           `json:"entityId"`
	BaseVersion *int64           `json:"baseVersion"`
	Payload     operationPayload `json:"payload"`
}

type operationPayload struct {
	Content   notes.Content `json:"content"`
	Blocks    []notes.Block `json:"blocks"`
	PlainText string        `json:"plainText"`
}

type pushResultDTO struct {
	OpID    string `json:"opId"`
	Status  string `json:"status"`
	NoteID  string `json:"noteId,omitempty"`
	Version int64  `json:"version,omitempty"`
}

type cursorDTO struct {
	UpdatedAt string `json:"updatedAt"`
	ID        string `json:"id"`
}

type pullRequest struct {
	Cursor *cursorDTO `json:"cursor"`
	Limit  int        `json:"limit"`
}

type pullNoteDTO struct {
	ID                   string        `json:"id"`
	NoteID               string        `json:"noteId"`
	ClientID             string        `json:"clientId"`
	Content              notes.Content `json:"content"`
	PlainText            string        `json:"plainText"`
	Version              int64         `json:"version"`
	UpdatedAt            time.Time     `json:"updatedAt"`
	DeletedAt            *time.Time    `json:"deletedAt,omitempty"`
	PermanentlyDeletedAt *time.Time    `json:"permanentlyDeletedAt,omitempty"`
	Tombstone            string        `json:"tombstone,omitempty"`
}

func (h *Handler) Push(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "sync service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	sessionID, hasSessionID := httpx.SessionIDFromContext(r.Context())
	var sessionIDPtr *uuid.UUID
	if hasSessionID && sessionID != uuid.Nil {
		sessionIDPtr = &sessionID
	}

	var req pushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
		return
	}
	if len(req.Operations) == 0 {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "operations are required")
		return
	}

	out := make([]pushResultDTO, 0, len(req.Operations))
	for _, item := range req.Operations {
		op, err := toOperation(item)
		if err != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		result, err := h.svc.Push(r.Context(), userID, sessionIDPtr, op)
		if err != nil {
			if errors.Is(err, notes.ErrNoteNotFound) {
				httpx.WriteError(w, r, http.StatusNotFound, "note_not_found", "note not found")
				return
			}
			httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "push sync operations failed")
			return
		}
		out = append(out, toPushResultDTO(item.OpID, result))
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"results": out})
}

func (h *Handler) Pull(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "sync service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}

	cursor, limit, ok := decodePullInput(w, r)
	if !ok {
		return
	}
	result, err := h.svc.Pull(r.Context(), userID, cursor, limit)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "pull sync changes failed")
		return
	}

	notesOut := make([]pullNoteDTO, 0, len(result.Items))
	for _, item := range result.Items {
		notesOut = append(notesOut, toPullNoteDTO(item))
	}

	var nextCursor *cursorDTO
	if result.NextCursor != nil {
		nextCursor = toCursorDTO(*result.NextCursor)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": result.Items, "notes": notesOut, "cursor": nextCursor, "nextCursor": nextCursor})
}

func toOperation(req operationRequest) (Operation, error) {
	opID := strings.TrimSpace(req.OpID)
	if opID == "" {
		return Operation{}, errors.New("opId is required")
	}
	entity := strings.TrimSpace(req.Entity)
	if entity == "" {
		entity = "note"
	}
	action := strings.TrimSpace(req.Action)
	if action == "" {
		return Operation{}, errors.New("action is required")
	}
	clientID := strings.TrimSpace(req.ClientID)
	if clientID == "" {
		return Operation{}, errors.New("clientId is required")
	}

	var entityID *uuid.UUID
	idRaw := strings.TrimSpace(req.EntityID)
	if idRaw == "" {
		idRaw = strings.TrimSpace(req.NoteID)
	}
	if idRaw != "" {
		id, err := uuid.Parse(idRaw)
		if err != nil || id == uuid.Nil {
			return Operation{}, errors.New("invalid noteId")
		}
		entityID = &id
	}

	content := req.Payload.Content
	if len(content.Blocks) == 0 && len(req.Payload.Blocks) > 0 {
		content.Blocks = req.Payload.Blocks
	}
	plainText := req.Payload.PlainText
	if plainText == "" {
		plainText = plainTextFromBlocks(content.Blocks)
	}

	return Operation{OpID: opID, Entity: entity, Action: action, ClientID: clientID, EntityID: entityID, BaseVersion: req.BaseVersion, Payload: Payload{Content: content, PlainText: plainText}}, nil
}

func decodePullInput(w http.ResponseWriter, r *http.Request) (Cursor, int, bool) {
	if r.Method == http.MethodPost {
		var req pullRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid json body")
			return Cursor{}, 0, false
		}
		cursor, ok := parseCursor(req.Cursor)
		if !ok {
			httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid cursor")
			return Cursor{}, 0, false
		}
		return cursor, req.Limit, true
	}

	query := r.URL.Query()
	limit, err := parseLimit(query.Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid limit")
		return Cursor{}, 0, false
	}
	cursor, ok := parseCursor(&cursorDTO{UpdatedAt: query.Get("updatedAt"), ID: query.Get("id")})
	if !ok {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid cursor")
		return Cursor{}, 0, false
	}
	return cursor, limit, true
}

func parseCursor(raw *cursorDTO) (Cursor, bool) {
	if raw == nil || strings.TrimSpace(raw.UpdatedAt) == "" {
		return Cursor{}, true
	}
	updatedAt, err := time.Parse(time.RFC3339, raw.UpdatedAt)
	if err != nil {
		return Cursor{}, false
	}
	id := uuid.Nil
	if strings.TrimSpace(raw.ID) != "" {
		parsed, err := uuid.Parse(raw.ID)
		if err != nil {
			return Cursor{}, false
		}
		id = parsed
	}
	return Cursor{UpdatedAt: updatedAt, ID: id}, true
}

func parseLimit(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	return strconv.Atoi(raw)
}

func toPushResultDTO(opID string, result PushResult) pushResultDTO {
	out := pushResultDTO{OpID: opID, Status: result.Status, Version: result.Version}
	if result.NoteID != nil {
		out.NoteID = result.NoteID.String()
	}
	return out
}

func toCursorDTO(cursor Cursor) *cursorDTO {
	return &cursorDTO{UpdatedAt: cursor.UpdatedAt.UTC().Format(time.RFC3339Nano), ID: cursor.ID.String()}
}

func toPullNoteDTO(item PullItem) pullNoteDTO {
	id := item.NoteID.String()
	return pullNoteDTO{ID: id, NoteID: id, ClientID: item.ClientID, Content: item.Content, PlainText: item.PlainText, Version: item.Version, UpdatedAt: item.UpdatedAt, DeletedAt: item.DeletedAt, PermanentlyDeletedAt: item.PurgedAt, Tombstone: item.Tombstone}
}

func plainTextFromBlocks(blocks []notes.Block) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if block.Type == "paragraph" && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, block.Text)
		}
	}
	return strings.Join(parts, "\n\n")
}
