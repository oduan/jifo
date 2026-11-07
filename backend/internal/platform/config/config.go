package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment       string
	Addr              string
	DatabaseURL       string
	JWTSecret         string
	MediaRoot         string
	TrustedProxies    []string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
	CleanupInterval   time.Duration
	CleanupTimeout    time.Duration
	AuthRateLimit     int
	AuthRateWindow    time.Duration
	AccessTokenTTL    time.Duration
	// MediaUserQuotaBytes 是 per-user 媒体存储配额（字节）：nil = 未配置
	// （用 media 包默认 5 GiB），非 nil 的 0 = 不限制。
	MediaUserQuotaBytes *int64
	// PoolMaxConns 是 pgxpool 最大连接数；0 表示未配置，由 db 包取默认值
	// min(20, max(4, NumCPU))。
	PoolMaxConns int32
}

func Load() (Config, error) {
	cfg := Config{
		Environment:       strings.ToLower(getenv("APP_ENV", "development")),
		Addr:              getenv("ADDR", ":8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		JWTSecret:         os.Getenv("JWT_SECRET"),
		MediaRoot:         getenv("MEDIA_ROOT", "storage/media"),
		TrustedProxies:    splitCSV(os.Getenv("TRUSTED_PROXIES")),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ShutdownTimeout:   15 * time.Second,
		CleanupInterval:   time.Hour,
		CleanupTimeout:    10 * time.Minute,
		AuthRateLimit:     10,
		AuthRateWindow:    time.Minute,
		AccessTokenTTL:    15 * time.Minute,
	}
	if cfg.DatabaseURL == "" && strings.TrimSpace(os.Getenv("PGHOST")) == "" {
		return Config{}, errors.New("DATABASE_URL or PGHOST is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, errors.New("JWT_SECRET must be at least 32 bytes")
	}

	durations := []struct {
		key    string
		target *time.Duration
	}{{"HTTP_READ_HEADER_TIMEOUT", &cfg.ReadHeaderTimeout}, {"HTTP_READ_TIMEOUT", &cfg.ReadTimeout}, {"HTTP_WRITE_TIMEOUT", &cfg.WriteTimeout}, {"HTTP_IDLE_TIMEOUT", &cfg.IdleTimeout}, {"SHUTDOWN_TIMEOUT", &cfg.ShutdownTimeout}, {"CLEANUP_INTERVAL", &cfg.CleanupInterval}, {"CLEANUP_TIMEOUT", &cfg.CleanupTimeout}, {"AUTH_RATE_WINDOW", &cfg.AuthRateWindow}, {"ACCESS_TOKEN_TTL", &cfg.AccessTokenTTL}}
	for _, item := range durations {
		if raw := strings.TrimSpace(os.Getenv(item.key)); raw != "" {
			value, err := time.ParseDuration(raw)
			if err != nil || value <= 0 {
				return Config{}, fmt.Errorf("%s must be a positive duration", item.key)
			}
			*item.target = value
		}
	}
	if raw := strings.TrimSpace(os.Getenv("AUTH_RATE_LIMIT")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return Config{}, errors.New("AUTH_RATE_LIMIT must be a positive integer")
		}
		cfg.AuthRateLimit = value
	}
	// MEDIA_USER_QUOTA_BYTES：per-user 媒体配额，单位字节；未配置时保持 nil
	//（由 media 包取默认 5 GiB），显式配置 0 表示不限制。
	if raw := strings.TrimSpace(os.Getenv("MEDIA_USER_QUOTA_BYTES")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			return Config{}, errors.New("MEDIA_USER_QUOTA_BYTES must be a non-negative integer")
		}
		cfg.MediaUserQuotaBytes = &value
	}
	// PGPOOL_MAX_CONNS：pgxpool 最大连接数；未配置时留 0，由 db 包取默认值。
	if raw := strings.TrimSpace(os.Getenv("PGPOOL_MAX_CONNS")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return Config{}, errors.New("PGPOOL_MAX_CONNS must be a positive integer")
		}
		cfg.PoolMaxConns = int32(value)
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
