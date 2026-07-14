package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeDB struct{ err error }

func (f fakeDB) Ping(context.Context) error { return f.err }

func TestReadyChecksDatabaseAndMediaDirectory(t *testing.T) {
	h := NewHandler(fakeDB{}, t.TempDir())
	resp := httptest.NewRecorder()
	h.Ready(resp, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.Code)
	}

	h = NewHandler(fakeDB{err: errors.New("down")}, t.TempDir())
	resp = httptest.NewRecorder()
	h.Ready(resp, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if resp.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.Code)
	}
}
