package health

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"jifo/backend/internal/platform/httpx"
)

type Database interface {
	Ping(context.Context) error
}

type Handler struct {
	db        Database
	mediaRoot string
}

func NewHandler(db Database, mediaRoot string) *Handler {
	return &Handler{db: db, mediaRoot: mediaRoot}
}

func (h *Handler) Live(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if h.db == nil || h.db.Ping(ctx) != nil || !directoryWritable(h.mediaRoot) {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func directoryWritable(root string) bool {
	if root == "" {
		return false
	}
	if err := os.MkdirAll(root, 0o750); err != nil {
		return false
	}
	file, err := os.CreateTemp(root, ".ready-*")
	if err != nil {
		return false
	}
	name := file.Name()
	closeErr := file.Close()
	removeErr := os.Remove(filepath.Clean(name))
	return closeErr == nil && removeErr == nil
}
