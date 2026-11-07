package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

// forwardedWarningInterval 控制"未配置 TRUSTED_PROXIES 却收到 X-Forwarded-For"
// 告警的输出频率：同一情况每分钟最多一条，避免高流量下刷爆日志。
const forwardedWarningInterval = time.Minute

type ProxyResolver struct {
	trusted []*net.IPNet
	// 未配置可信代理时的节流告警状态（受 warnMu 保护）。
	warnMu sync.Mutex
	// lastForwardedWarnAt 记录上一条告警的输出时刻；warnNow 与 logger 是测试接缝。
	warnNow             func() time.Time
	logger              *slog.Logger
	lastForwardedWarnAt time.Time
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
		if (p == nil || len(p.trusted) == 0) && strings.TrimSpace(r.Header.Get("X-Forwarded-For")) != "" {
			p.warnForwardedWithoutTrust()
		}
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

// warnForwardedWithoutTrust 在未配置 TRUSTED_PROXIES 但请求携带 X-Forwarded-For
// 时输出节流告警。此时转发头不可信，客户端 IP 直接取自 RemoteAddr：
// 限流按反代 IP 聚合而退化（同源所有用户共享一个桶），且来源可伪造该头
// 制造日志噪音或绕过任何依赖转发头的策略。同一情况每分钟最多提示一次。
func (p *ProxyResolver) warnForwardedWithoutTrust() {
	if p == nil {
		return
	}
	nowFn := p.warnNow
	if nowFn == nil {
		nowFn = time.Now
	}
	now := nowFn()
	p.warnMu.Lock()
	defer p.warnMu.Unlock()
	if !p.lastForwardedWarnAt.IsZero() && now.Sub(p.lastForwardedWarnAt) < forwardedWarningInterval {
		return
	}
	p.lastForwardedWarnAt = now
	logger := p.logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Warn("x_forwarded_for_ignored_without_trusted_proxies",
		"message", "未配置 TRUSTED_PROXIES 但请求携带 X-Forwarded-For：转发头将被忽略，客户端限流退化为按代理 IP 聚合，且可被伪造头绕过",
		"hint", "如部署在反向代理之后，请配置 TRUSTED_PROXIES 指向代理网段")
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

// EmailMiddleware 在现有 IP+path 限流之外，为 /api/auth/login 与
// /api/auth/register 增加按目标 email 的独立限流桶：两桶并行生效，
// 任一超限都返回 429。分布式攻击者各用一个 IP 时 IP 桶拦不住，
// email 桶把预算收敛到被攻击的账号上。
//
// 实现说明：email 必须从已解析的请求体取。auth 包不在本批修改范围
// （并行任务在改），无法在 handler 层实现，因此选择在中间件层缓冲整个
// 请求体（上游 RequestBodyLimit 已把请求体限制在 2MiB 内）提取 email 字段，
// 再用等价 reader 回填请求体，下游 handler 仍能完整解析。
// 提取不到 email（body 为空/非法 JSON）时跳过 email 桶，交由下游按原有语义报错；
// 读取失败（超限/断连）时不回填，保留既有错误路径。
// email 桶的 key 不含 path：login 与 register 对同一目标邮箱共享预算，
// 换端点不能翻倍消耗被攻击账号的配额。
func (l *RateLimiter) EmailMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email := extractEmailFromBody(r)
		if email != "" {
			if !l.allow("email:" + email) {
				retryAfter := int64(l.window / time.Second)
				if retryAfter < 1 {
					retryAfter = 1
				}
				w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
				WriteError(w, r, http.StatusTooManyRequests, "rate_limited", "too many requests for this email")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// extractEmailFromBody 缓冲请求体解析出 email 字段（与 auth 服务的
// normalizeEmail 一致：去空白 + 小写，避免同邮箱的大小写变体绕过桶），
// 并把等价 reader 回填给下游。返回空串表示没有可用于限流的 email。
func extractEmailFromBody(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	body, err := io.ReadAll(r.Body)
	_ = r.Body.Close()
	if err != nil {
		// 请求体不可读（超限/断连）：不回填。MaxBytesReader 会继续向下游
		// 返回同一错误，断连等情形下游读到 EOF，最终都走既有的 400 路径。
		return ""
	}
	var payload struct {
		Email string `json:"email"`
	}
	_ = json.Unmarshal(body, &payload)
	r.Body = io.NopCloser(bytes.NewReader(body))
	return strings.ToLower(strings.TrimSpace(payload.Email))
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
				// 满载且无过期项：淘汰 reset 最早的一条，接纳新来源而不是一律拒绝。
				var oldestKey string
				var oldestReset time.Time
				for candidate, value := range l.entries {
					if oldestKey == "" || value.reset.Before(oldestReset) {
						oldestKey = candidate
						oldestReset = value.reset
					}
				}
				delete(l.entries, oldestKey)
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
