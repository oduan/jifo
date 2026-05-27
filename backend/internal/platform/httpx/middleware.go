package httpx

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type contextKey string

const (
	requestIDContextKey contextKey = "request-id"
	userIDContextKey    contextKey = "user-id"
	sessionIDContextKey contextKey = "session-id"
)

type TokenValidator func(ctx context.Context, tokenString string) (uuid.UUID, uuid.UUID, error)

func RequireAuth(validator TokenValidator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if validator == nil {
				WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing auth validator")
				return
			}
			authorization := strings.TrimSpace(r.Header.Get("Authorization"))
			if !strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
				WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			token := strings.TrimSpace(authorization[len("Bearer "):])
			if token == "" {
				WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			userID, sessionID, err := validator(r.Context(), token)
			if err != nil {
				WriteError(w, r, http.StatusUnauthorized, "unauthorized", "invalid access token")
				return
			}
			ctx := context.WithValue(r.Context(), userIDContextKey, userID)
			ctx = context.WithValue(ctx, sessionIDContextKey, sessionID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v := ctx.Value(userIDContextKey)
	id, ok := v.(uuid.UUID)
	return id, ok
}

func SessionIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v := ctx.Value(sessionIDContextKey)
	id, ok := v.(uuid.UUID)
	return id, ok
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-Id"))
		if requestID == "" {
			requestID = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", requestID)
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequestIDFromContext(ctx context.Context) string {
	v := ctx.Value(requestIDContextKey)
	requestID, _ := v.(string)
	return requestID
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	WriteJSON(w, status, NewError(code, message, RequestIDFromContext(r.Context())))
}
