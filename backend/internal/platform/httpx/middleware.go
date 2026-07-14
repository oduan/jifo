package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type contextKey string

const (
	requestIDContextKey contextKey = "request-id"
	userIDContextKey    contextKey = "user-id"
	sessionIDContextKey contextKey = "session-id"
	clientIPContextKey  contextKey = "client-ip"
	requestMetaKey      contextKey = "request-meta"
)

var ErrUnauthorized = errors.New("unauthorized")

type requestMeta struct {
	mu     sync.RWMutex
	userID uuid.UUID
}

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
				if errors.Is(err, ErrUnauthorized) {
					WriteError(w, r, http.StatusUnauthorized, "unauthorized", "invalid access token")
					return
				}
				WriteError(w, r, http.StatusInternalServerError, "internal_error", "auth validation failed")
				return
			}
			ctx := context.WithValue(r.Context(), userIDContextKey, userID)
			ctx = context.WithValue(ctx, sessionIDContextKey, sessionID)
			if meta, ok := r.Context().Value(requestMetaKey).(*requestMeta); ok {
				meta.mu.Lock()
				meta.userID = userID
				meta.mu.Unlock()
			}
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

func RequireUserSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sessionID, ok := SessionIDFromContext(r.Context())
		if !ok || sessionID == uuid.Nil {
			WriteError(w, r, http.StatusForbidden, "user_session_required", "a user session is required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-Id"))
		if requestID == "" {
			requestID = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", requestID)
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		ctx = context.WithValue(ctx, requestMetaKey, &requestMeta{})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(p)
	w.bytes += n
	return n, err
}

func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			sw := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(sw, r)
			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			attrs := []any{"requestId", RequestIDFromContext(r.Context()), "method", r.Method, "path", r.URL.Path, "status", status, "durationMs", time.Since(started).Milliseconds(), "bytes", sw.bytes, "clientIp", ClientIPFromContext(r.Context()), "userAgent", r.UserAgent()}
			if meta, ok := r.Context().Value(requestMetaKey).(*requestMeta); ok {
				meta.mu.RLock()
				userID := meta.userID
				meta.mu.RUnlock()
				if userID != uuid.Nil {
					attrs = append(attrs, "userId", userID.String())
				}
			}
			logger.Info("http request", attrs...)
		})
	}
}

func Recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("http panic", "requestId", RequestIDFromContext(r.Context()), "panic", recovered, "stack", string(debug.Stack()))
					WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func RequestBodyLimit(defaultLimit, mediaLimit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			limit := defaultLimit
			if r.Method == http.MethodPost && r.URL.Path == "/api/media" {
				limit = mediaLimit
			}
			if r.Body != nil && limit > 0 {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

type ProxyResolver struct {
	trusted []*net.IPNet
}

func NewProxyResolver(entries []string) (*ProxyResolver, error) {
	resolver := &ProxyResolver{}
	for _, entry := range entries {
		if !strings.Contains(entry, "/") {
			ip := net.ParseIP(entry)
			if ip == nil {
				return nil, errors.New("invalid trusted proxy: " + entry)
			}
			bits := 128
			if ip.To4() != nil {
				bits = 32
				ip = ip.To4()
			}
			resolver.trusted = append(resolver.trusted, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
			continue
		}
		_, network, err := net.ParseCIDR(entry)
		if err != nil {
			return nil, errors.New("invalid trusted proxy: " + entry)
		}
		resolver.trusted = append(resolver.trusted, network)
	}
	return resolver, nil
}

func (p *ProxyResolver) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remote := hostIP(r.RemoteAddr)
		client := remote
		if p != nil && p.contains(remote) {
			forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
			for i := len(forwarded) - 1; i >= 0; i-- {
				parsed := net.ParseIP(strings.TrimSpace(forwarded[i]))
				if parsed == nil {
					continue
				}
				client = parsed.String()
				if !p.contains(client) {
					break
				}
			}
		}
		ctx := context.WithValue(r.Context(), clientIPContextKey, client)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (p *ProxyResolver) contains(ipString string) bool {
	ip := net.ParseIP(ipString)
	if ip == nil {
		return false
	}
	for _, network := range p.trusted {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func hostIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return strings.Trim(remoteAddr, "[]")
}

func ClientIPFromContext(ctx context.Context) string {
	value, _ := ctx.Value(clientIPContextKey).(string)
	return value
}

type rateEntry struct {
	count int
	reset time.Time
}

type RateLimiter struct {
	mu         sync.Mutex
	entries    map[string]rateEntry
	limit      int
	window     time.Duration
	maxEntries int
	now        func() time.Time
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{entries: make(map[string]rateEntry), limit: limit, window: window, maxEntries: 10000, now: time.Now}
}

func (l *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := ClientIPFromContext(r.Context())
		if key == "" {
			key = hostIP(r.RemoteAddr)
		}
		key += ":" + r.URL.Path
		if !l.allow(key) {
			retryAfter := int64(l.window / time.Second)
			if retryAfter < 1 {
				retryAfter = 1
			}
			w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
			WriteError(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (l *RateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	entry, ok := l.entries[key]
	if !ok || !now.Before(entry.reset) {
		if len(l.entries) >= l.maxEntries {
			for candidate, value := range l.entries {
				if !now.Before(value.reset) {
					delete(l.entries, candidate)
				}
			}
			if len(l.entries) >= l.maxEntries {
				return false
			}
		}
		l.entries[key] = rateEntry{count: 1, reset: now.Add(l.window)}
		return true
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
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
