package sync

import (
	"net/http"

	"jifo/backend/internal/platform/httpx"
)

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

func (h *Handler) RegisterRoutes(mux interface {
	Post(pattern string, handlerFn http.HandlerFunc)
}) {
	mux.Post("/sync/push", h.Push)
}

func (h *Handler) Push(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusNotImplemented, "not_implemented", "sync handler not implemented")
}
