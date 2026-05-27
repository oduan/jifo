package media

import (
	"net/http"

	"jifo/backend/internal/platform/httpx"
)

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

func (h *Handler) RegisterRoutes(mux interface {
	Get(pattern string, handlerFn http.HandlerFunc)
}) {
	mux.Get("/media", h.List)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": []any{}})
}
