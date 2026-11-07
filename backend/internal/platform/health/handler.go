package health

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"jifo/backend/internal/platform/httpx"
)

type Database interface {
	Ping(context.Context) error
}

// readyDiskProbeTTL 是磁盘探测结果的缓存时长：readyz 可能被负载均衡
// 高频拉取，每次都创建临时文件既慢又产生 IO 噪音，窗口内直接返回缓存结论。
// 探测失败同样缓存（最坏 5 秒后才恢复 ready），换取磁盘故障时的探测压力骤减。
const readyDiskProbeTTL = 5 * time.Second

type Handler struct {
	db        Database
	mediaRoot string

	// 磁盘探测缓存状态（受 probeMu 保护）。
	probeMu  sync.Mutex
	probeAt  time.Time
	probeOK  bool
	probeTTL time.Duration
	// now 与 probe 是测试接缝：分别控制时钟与探测函数。
	now   func() time.Time
	probe func(string) bool
}

func NewHandler(db Database, mediaRoot string) *Handler {
	return &Handler{db: db, mediaRoot: mediaRoot, probeTTL: readyDiskProbeTTL, probe: directoryWritable}
}

func (h *Handler) Live(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if h.db == nil || h.db.Ping(ctx) != nil || !h.mediaRootWritable() {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// mediaRootWritable 返回缓存窗口内的磁盘探测结论，窗口过期才真正执行探测。
func (h *Handler) mediaRootWritable() bool {
	ttl := h.probeTTL
	if ttl <= 0 {
		// 未初始化 TTL（零值 Handler）：退化为每次都探测，保持旧行为。
		return h.runProbe()
	}
	nowFn := h.now
	if nowFn == nil {
		nowFn = time.Now
	}
	now := nowFn()
	h.probeMu.Lock()
	defer h.probeMu.Unlock()
	if !h.probeAt.IsZero() && now.Sub(h.probeAt) < ttl {
		return h.probeOK
	}
	h.probeOK = h.runProbe()
	h.probeAt = now
	return h.probeOK
}

func (h *Handler) runProbe() bool {
	probe := h.probe
	if probe == nil {
		probe = directoryWritable
	}
	return probe(h.mediaRoot)
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
