package heatmap

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	Aggregate(ctx context.Context, userID uuid.UUID, from time.Time, to time.Time) ([]DayCount, error)
}

type Handler struct {
	svc HandlerService
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
}

type dayCountDTO struct {
	Date         string `json:"date"`
	CreatedCount int64  `json:"createdCount"`
	UpdatedCount int64  `json:"updatedCount"`
	TotalCount   int64  `json:"totalCount"`
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "heatmap service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	timezone := r.URL.Query().Get("timezone")
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid timezone")
		return
	}
	from, err := time.ParseInLocation("2006-01-02", r.URL.Query().Get("from"), location)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid from date")
		return
	}
	to, err := time.ParseInLocation("2006-01-02", r.URL.Query().Get("to"), location)
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid to date")
		return
	}
	items, err := h.svc.Aggregate(r.Context(), userID, from, to)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "load heatmap failed")
		return
	}
	out := make([]dayCountDTO, 0, len(items))
	for _, item := range items {
		out = append(out, dayCountDTO{Date: item.Date.Format("2006-01-02"), CreatedCount: item.CreatedCount, UpdatedCount: item.UpdatedCount, TotalCount: item.TotalCount})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"days": out})
}
