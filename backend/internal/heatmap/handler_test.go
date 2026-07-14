package heatmap

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type capturingHeatmapService struct {
	from time.Time
	to   time.Time
}

func (s *capturingHeatmapService) Aggregate(_ context.Context, _ uuid.UUID, from time.Time, to time.Time) ([]DayCount, error) {
	s.from = from
	s.to = to
	return nil, nil
}

func serveAuthenticatedHeatmap(handler http.Handler, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()
	httpx.RequireAuth(func(context.Context, string) (uuid.UUID, uuid.UUID, error) {
		return uuid.New(), uuid.Nil, nil
	})(handler).ServeHTTP(rr, req)
	return rr
}

func TestHandlerParsesDatesInBrowserTimezone(t *testing.T) {
	svc := &capturingHeatmapService{}
	rr := serveAuthenticatedHeatmap(http.HandlerFunc(NewHandler(svc).Get), "/heatmap?from=2026-03-08&to=2026-03-09&timezone=America%2FNew_York")

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if got := svc.from.Format(time.RFC3339); got != "2026-03-08T00:00:00-05:00" {
		t.Fatalf("from = %s", got)
	}
	if got := svc.to.Format(time.RFC3339); got != "2026-03-09T00:00:00-04:00" {
		t.Fatalf("to = %s", got)
	}
}

func TestHandlerRejectsInvalidTimezone(t *testing.T) {
	rr := serveAuthenticatedHeatmap(http.HandlerFunc(NewHandler(&capturingHeatmapService{}).Get), "/heatmap?from=2026-05-01&to=2026-05-02&timezone=not-a-timezone")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}
