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
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	if cfg.Environment == "production" && len(cfg.JWTSecret) < 32 {
		return Config{}, errors.New("JWT_SECRET must be at least 32 bytes in production")
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
