package db

import (
	"runtime"
	"testing"
	"time"
)

func TestOpenAllowsEmptyURLForStandardPostgresEnvironment(t *testing.T) {
	pool, err := Open(t.Context(), "")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	pool.Close()
}

func TestDefaultPoolSettingsMatchesSpecifiedBounds(t *testing.T) {
	settings := DefaultPoolSettings()

	wantMaxConns := runtime.NumCPU()
	if wantMaxConns < 4 {
		wantMaxConns = 4
	}
	if wantMaxConns > 20 {
		wantMaxConns = 20
	}
	if settings.MaxConns != int32(wantMaxConns) {
		t.Fatalf("MaxConns = %d, want min(20, max(4, NumCPU)) = %d", settings.MaxConns, wantMaxConns)
	}
	if settings.MinConns != 2 {
		t.Fatalf("MinConns = %d, want 2", settings.MinConns)
	}
	if settings.MaxConnLifetime != 30*time.Minute {
		t.Fatalf("MaxConnLifetime = %v, want 30m", settings.MaxConnLifetime)
	}
	if settings.MaxConnIdleTime != 5*time.Minute {
		t.Fatalf("MaxConnIdleTime = %v, want 5m", settings.MaxConnIdleTime)
	}
	if settings.HealthCheckPeriod != 30*time.Second {
		t.Fatalf("HealthCheckPeriod = %v, want 30s", settings.HealthCheckPeriod)
	}
}

func TestBuildPoolConfigAppliesExplicitSettings(t *testing.T) {
	settings := PoolSettings{
		MaxConns:          7,
		MinConns:          1,
		MaxConnLifetime:   10 * time.Minute,
		MaxConnIdleTime:   2 * time.Minute,
		HealthCheckPeriod: 15 * time.Second,
	}
	poolConfig, err := buildPoolConfig("postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable", settings)
	if err != nil {
		t.Fatalf("buildPoolConfig() error = %v", err)
	}
	if poolConfig.MaxConns != 7 {
		t.Fatalf("MaxConns = %d, want 7", poolConfig.MaxConns)
	}
	if poolConfig.MinConns != 1 {
		t.Fatalf("MinConns = %d, want 1", poolConfig.MinConns)
	}
	if poolConfig.MaxConnLifetime != 10*time.Minute {
		t.Fatalf("MaxConnLifetime = %v, want 10m", poolConfig.MaxConnLifetime)
	}
	if poolConfig.MaxConnIdleTime != 2*time.Minute {
		t.Fatalf("MaxConnIdleTime = %v, want 2m", poolConfig.MaxConnIdleTime)
	}
	if poolConfig.HealthCheckPeriod != 15*time.Second {
		t.Fatalf("HealthCheckPeriod = %v, want 15s", poolConfig.HealthCheckPeriod)
	}
	// 连接串参数不被显式池上限覆盖：ParseConfig 解析出的连接信息应保留。
	if poolConfig.ConnConfig.Host != "localhost" || poolConfig.ConnConfig.User != "jifo" {
		t.Fatalf("conn host/user = %q/%q, want ParseConfig-parsed localhost/jifo", poolConfig.ConnConfig.Host, poolConfig.ConnConfig.User)
	}
}
