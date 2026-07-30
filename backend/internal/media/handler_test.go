package media

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"

	"github.com/google/uuid"

	"jifo/backend/internal/platform/httpx"
)

type fakeUploadService struct {
	input UploadInput
}

func (f *fakeUploadService) List(ctx context.Context, userID uuid.UUID) ([]Asset, error) {
	return nil, nil
}

func (f *fakeUploadService) Get(ctx context.Context, userID uuid.UUID, assetID uuid.UUID) (Asset, error) {
	return Asset{}, nil
}

func (f *fakeUploadService) Open(asset Asset) (File, error) {
	return nil, nil
}

func (f *fakeUploadService) Upload(ctx context.Context, input UploadInput) (Asset, error) {
	f.input = input
	// Drain the reader so the handler's MultiReader path is exercised.
	if _, err := io.Copy(io.Discard, input.Reader); err != nil {
		return Asset{}, err
	}
	return Asset{ID: uuid.New(), UserID: input.UserID, Kind: input.Kind, MIMEType: input.MIMEType, SizeBytes: input.SizeBytes}, nil
}

func multipartUploadRequest(t *testing.T, declaredType string, content []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="upload.bin"`)
	if declaredType != "" {
		header.Set("Content-Type", declaredType)
	}
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/media", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer test-token")
	return req
}

func serveAuthenticatedUpload(h *Handler, rr *httptest.ResponseRecorder, req *http.Request, userID uuid.UUID) {
	handler := httpx.RequireAuth(func(ctx context.Context, token string) (uuid.UUID, uuid.UUID, error) {
		return userID, uuid.Nil, nil
	})(http.HandlerFunc(h.Upload))
	handler.ServeHTTP(rr, req)
}

var pngBytes = append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, make([]byte, 64)...)

func TestUploadRejectsDeclaredTypeMismatchingSniffedContent(t *testing.T) {
	svc := &fakeUploadService{}
	h := NewHandler(svc)
	rr := httptest.NewRecorder()
	req := multipartUploadRequest(t, "image/png", []byte("<html><body>not an image</body></html>"))

	serveAuthenticatedUpload(h, rr, req, uuid.New())

	if rr.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d body=%s, want 415", rr.Code, rr.Body.String())
	}
}

func TestUploadStoresSniffedMIMETypeNotClientDeclared(t *testing.T) {
	svc := &fakeUploadService{}
	h := NewHandler(svc)
	rr := httptest.NewRecorder()
	req := multipartUploadRequest(t, "image/webp", pngBytes)

	serveAuthenticatedUpload(h, rr, req, uuid.New())

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s, want 201", rr.Code, rr.Body.String())
	}
	if svc.input.MIMEType != "image/png" {
		t.Fatalf("stored MIMEType = %q, want sniffed image/png", svc.input.MIMEType)
	}
}

func TestUploadSniffsMIMETypeWhenDeclarationMissing(t *testing.T) {
	svc := &fakeUploadService{}
	h := NewHandler(svc)
	rr := httptest.NewRecorder()
	req := multipartUploadRequest(t, "", pngBytes)

	serveAuthenticatedUpload(h, rr, req, uuid.New())

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s, want 201", rr.Code, rr.Body.String())
	}
	if svc.input.MIMEType != "image/png" {
		t.Fatalf("stored MIMEType = %q, want image/png", svc.input.MIMEType)
	}
}
