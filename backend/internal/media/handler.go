package media

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type HandlerService interface {
	List(ctx context.Context, userID uuid.UUID) ([]Asset, error)
	Get(ctx context.Context, userID uuid.UUID, assetID uuid.UUID) (Asset, error)
	Open(asset Asset) (File, error)
	Upload(ctx context.Context, input UploadInput) (Asset, error)
}

type File interface {
	io.Reader
	io.Seeker
	io.Closer
}

type Handler struct {
	svc HandlerService
}

func NewHandler(svc HandlerService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(mux interface {
	Get(pattern string, handlerFn http.HandlerFunc)
	Post(pattern string, handlerFn http.HandlerFunc)
}) {
	mux.Get("/media", h.List)
	mux.Post("/media", h.Upload)
	mux.Get("/media/{mediaID}", h.Get)
}

type assetDTO struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	MIMEType  string    `json:"mimeType"`
	SizeBytes int64     `json:"sizeBytes"`
	Checksum  string    `json:"checksum"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "media service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	items, err := h.svc.List(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "list media failed")
		return
	}
	out := make([]assetDTO, 0, len(items))
	for _, item := range items {
		out = append(out, toAssetDTO(item))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "media service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, DefaultMaxSizeBytes+1024*1024)
	if err := r.ParseMultipartForm(DefaultMaxSizeBytes + 1024*1024); err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid multipart body")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "file is required")
		return
	}
	defer file.Close()

	prefix := make([]byte, 512)
	n, readErr := io.ReadFull(file, prefix)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) && !errors.Is(readErr, io.EOF) {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "read file failed")
		return
	}
	prefix = prefix[:n]
	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(prefix)
	}

	asset, err := h.svc.Upload(r.Context(), UploadInput{
		UserID:    userID,
		Kind:      "image",
		MIMEType:  mimeType,
		SizeBytes: header.Size,
		Checksum:  strings.TrimSpace(r.FormValue("checksum")),
		Reader:    io.MultiReader(bytes.NewReader(prefix), file),
	})
	if err != nil {
		writeUploadError(w, r, err)
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"item": toAssetDTO(asset)})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "media service not configured")
		return
	}
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing user context")
		return
	}
	mediaID, err := uuid.Parse(chi.URLParam(r, "mediaID"))
	if err != nil || mediaID == uuid.Nil {
		httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid media id")
		return
	}
	asset, err := h.svc.Get(r.Context(), userID, mediaID)
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			httpx.WriteError(w, r, http.StatusNotFound, "media_not_found", "media not found")
			return
		}
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "load media failed")
		return
	}
	file, err := h.svc.Open(asset)
	if err != nil {
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "open media failed")
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", asset.MIMEType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Disposition", `inline; filename="`+asset.ID.String()+`"`)
	http.ServeContent(w, r, asset.ID.String(), asset.CreatedAt, file)
}

func writeUploadError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidMIMEType):
		httpx.WriteError(w, r, http.StatusUnsupportedMediaType, "invalid_media_type", "unsupported media type")
	case errors.Is(err, ErrInvalidSize):
		httpx.WriteError(w, r, http.StatusBadRequest, "invalid_media_size", "invalid media size")
	case errors.Is(err, ErrFileTooLarge):
		httpx.WriteError(w, r, http.StatusRequestEntityTooLarge, "file_too_large", "media file too large")
	case errors.Is(err, ErrChecksumMismatch):
		httpx.WriteError(w, r, http.StatusBadRequest, "checksum_mismatch", "media checksum mismatch")
	default:
		httpx.WriteError(w, r, http.StatusInternalServerError, "internal_error", "upload media failed")
	}
}

func toAssetDTO(asset Asset) assetDTO {
	id := asset.ID.String()
	return assetDTO{ID: id, Kind: asset.Kind, MIMEType: asset.MIMEType, SizeBytes: asset.SizeBytes, Checksum: asset.Checksum, URL: "/api/media/" + id, CreatedAt: asset.CreatedAt}
}
