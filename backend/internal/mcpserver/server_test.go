package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/httpx"
	"jifo/backend/internal/tags"
)

type fakeNotes struct {
	filter notes.ListFilter
}

func (f *fakeNotes) Create(_ context.Context, input notes.CreateInput) (notes.Note, error) {
	return notes.Note{ID: uuid.New(), UserID: input.UserID, ClientID: input.ClientID, Content: input.Content, PlainText: input.PlainText, Version: 1}, nil
}

func (f *fakeNotes) List(_ context.Context, filter notes.ListFilter) (notes.ListResult, error) {
	f.filter = filter
	return notes.ListResult{Items: []notes.Note{{ID: uuid.New(), UserID: filter.UserID, ClientID: "c1", PlainText: "matched", CreatedAt: time.Now(), UpdatedAt: time.Now(), Version: 1}}, HasMore: true}, nil
}

func (f *fakeNotes) Update(_ context.Context, input notes.UpdateInput) (notes.Note, error) {
	return notes.Note{ID: input.NoteID, UserID: input.UserID, ClientID: "c1", Content: input.Content, PlainText: input.PlainText, Version: 2}, nil
}

type fakeTags struct{}

func (*fakeTags) List(context.Context, uuid.UUID) ([]tags.Tag, error)        { return nil, nil }
func (*fakeTags) Tree(context.Context, uuid.UUID) ([]tags.TreeNode, error)   { return nil, nil }
func (*fakeTags) Rename(context.Context, uuid.UUID, uuid.UUID, string) error { return nil }
func (*fakeTags) Delete(context.Context, uuid.UUID, uuid.UUID, bool) error   { return nil }

func TestSearchNotesToolUsesAuthenticatedUserAndDefaultPagination(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	noteService := &fakeNotes{}
	handler := httpx.RequireAuth(func(context.Context, string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(NewHandler(noteService, &fakeTags{}))

	response := callMCP(t, handler, "token", map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params": map[string]any{
			"name": "search_notes",
			"arguments": map[string]any{
				"query":        "match",
				"tag_path":     "工作/项目",
				"created_from": "2026-01-01T00:00:00+08:00",
			},
		},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if noteService.filter.UserID != userID {
		t.Fatalf("user id = %s, want %s", noteService.filter.UserID, userID)
	}
	if noteService.filter.Limit != defaultPageSize || noteService.filter.Offset != 0 {
		t.Fatalf("pagination = limit %d offset %d, want %d/0", noteService.filter.Limit, noteService.filter.Offset, defaultPageSize)
	}
	if noteService.filter.Search != "match" || noteService.filter.TagPath != "工作/项目" || noteService.filter.CreatedFrom == nil {
		t.Fatalf("combined filter not forwarded: %+v", noteService.filter)
	}
	var payload struct {
		Result struct {
			StructuredContent struct {
				PageSize int  `json:"page_size"`
				HasMore  bool `json:"has_more"`
			} `json:"structuredContent"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Result.StructuredContent.PageSize != defaultPageSize || !payload.Result.StructuredContent.HasMore {
		t.Fatalf("unexpected structured response: %+v", payload.Result.StructuredContent)
	}
}

func TestMCPRequiresBearerToken(t *testing.T) {
	handler := httpx.RequireAuth(func(context.Context, string) (uuid.UUID, uuid.UUID, error) {
		return uuid.New(), uuid.Nil, nil
	})(NewHandler(&fakeNotes{}, &fakeTags{}))
	response := callMCP(t, handler, "", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestSearchNotesInputRejectsInvertedRanges(t *testing.T) {
	_, _, _, err := (searchNotesInput{CreatedFrom: "2026-02-01T00:00:00Z", CreatedTo: "2026-01-01T00:00:00Z"}).filter(uuid.New())
	if err == nil {
		t.Fatal("expected inverted range error")
	}
}

func callMCP(t *testing.T, handler http.Handler, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("Mcp-Protocol-Version", "2025-11-25")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
