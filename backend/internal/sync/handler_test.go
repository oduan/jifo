package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/httpx"
)

func TestClampPullLimit(t *testing.T) {
	tests := []struct {
		in   int
		want int
	}{
		{in: 0, want: 0},
		{in: -5, want: -5},
		{in: 100, want: 100},
		{in: maxPullLimit, want: maxPullLimit},
		{in: maxPullLimit + 1, want: maxPullLimit},
		{in: 100000, want: maxPullLimit},
	}
	for _, tt := range tests {
		if got := clampPullLimit(tt.in); got != tt.want {
			t.Fatalf("clampPullLimit(%d) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

type fakePushService struct{}

func (f *fakePushService) Push(ctx context.Context, userID uuid.UUID, sessionID *uuid.UUID, op Operation) (PushResult, error) {
	switch op.Action {
	case "create":
		id := uuid.New()
		return PushResult{Status: "created", NoteID: &id, Version: 1}, nil
	case "delete":
		return PushResult{}, notes.ErrNoteNotFound
	default:
		return PushResult{}, context.Canceled
	}
}

func (f *fakePushService) Pull(ctx context.Context, userID uuid.UUID, cursor Cursor, limit int) (PullResult, error) {
	return PullResult{}, nil
}

// TestPushPartialFailureReturnsPerOpErrors 验证单个操作失败不再让整批 4xx/5xx，
// 而是逐操作返回 error 状态与 code，其余操作照常成功。
func TestPushPartialFailureReturnsPerOpErrors(t *testing.T) {
	userID := uuid.New()
	h := NewHandler(&fakePushService{})

	body := `{"operations":[
		{"opId":"ok-create","entity":"note","action":"create","clientId":"c1","payload":{"blocks":[{"type":"paragraph","text":"hi"}]}},
		{"opId":"bad-op","entity":"note","action":"","clientId":"c2"},
		{"opId":"missing-note","entity":"note","action":"delete","clientId":"c3","noteId":"11111111-1111-1111-1111-111111111111"}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/sync/push", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()

	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(h.Push))
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}

	var resp struct {
		Results []pushResultDTO `json:"results"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal body: %v body=%s", err, rr.Body.String())
	}
	if len(resp.Results) != 3 {
		t.Fatalf("results len = %d, want 3 (%s)", len(resp.Results), rr.Body.String())
	}

	byOp := make(map[string]pushResultDTO, len(resp.Results))
	for _, r := range resp.Results {
		byOp[r.OpID] = r
	}

	if got := byOp["ok-create"]; got.Status != "created" {
		t.Fatalf("ok-create status = %q, want created", got.Status)
	}
	if got := byOp["bad-op"]; got.Status != "error" || got.Code != "bad_request" {
		t.Fatalf("bad-op = %+v, want status=error code=bad_request", got)
	}
	if got := byOp["missing-note"]; got.Status != "error" || got.Code != "note_not_found" {
		t.Fatalf("missing-note = %+v, want status=error code=note_not_found", got)
	}
}

func TestPushRejectsOversizedOperationBatch(t *testing.T) {
	operations := make([]string, maxPushOperations+1)
	for i := range operations {
		operations[i] = `{"opId":"op-` + strconv.Itoa(i) + `","entity":"note","action":"create","clientId":"c-` + strconv.Itoa(i) + `","payload":{"blocks":[]}}`
	}
	body := "{\"operations\":[" + strings.Join(operations, ",") + "]}"
	req := httptest.NewRequest(http.MethodPost, "/sync/push", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()
	userID := uuid.New()

	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(NewHandler(&fakePushService{}).Push))
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
}
