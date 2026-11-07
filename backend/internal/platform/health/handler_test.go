package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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

func TestReadyCachesDiskProbeWithinTTL(t *testing.T) {
	calls := 0
	h := NewHandler(fakeDB{}, t.TempDir())
	h.probe = func(string) bool {
		calls++
		return true
	}
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	h.now = func() time.Time { return now }

	callReady := func() int {
		resp := httptest.NewRecorder()
		h.Ready(resp, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		return resp.Code
	}

	// 窗口内反复拉取 readyz：磁盘探测只执行一次，结论直接复用。
	for i := 0; i < 5; i++ {
		if code := callReady(); code != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200", i+1, code)
		}
		now = now.Add(time.Second)
	}
	if calls != 1 {
		t.Fatalf("probe calls within TTL = %d, want 1", calls)
	}

	// 窗口过期后重新探测。
	now = now.Add(readyDiskProbeTTL)
	if code := callReady(); code != http.StatusOK {
		t.Fatalf("status after TTL = %d, want 200", code)
	}
	if calls != 2 {
		t.Fatalf("probe calls after TTL = %d, want 2", calls)
	}
}

func TestReadyCachesFailedDiskProbe(t *testing.T) {
	writable := false
	h := NewHandler(fakeDB{}, t.TempDir())
	h.probe = func(string) bool { return writable }
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	h.now = func() time.Time { return now }

	callReady := func() int {
		resp := httptest.NewRecorder()
		h.Ready(resp, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		return resp.Code
	}

	if code := callReady(); code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 while disk probe fails", code)
	}
	// 探测失败同样缓存：磁盘恢复后窗口内仍返回 503，窗口过期才恢复 200。
	writable = true
	if code := callReady(); code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want cached 503 within TTL", code)
	}
	now = now.Add(readyDiskProbeTTL + time.Nanosecond)
	if code := callReady(); code != http.StatusOK {
		t.Fatalf("status = %d, want 200 after TTL", code)
	}
}
