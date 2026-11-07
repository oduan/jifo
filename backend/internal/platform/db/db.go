package db

import (
	"context"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolSettings 是连接池的显式上限。pgx 默认不限制 MaxConns（受限于
// Postgres 默认 100 连接，多个实例并存时容易打满），这里显式收敛。
type PoolSettings struct {
	MaxConns          int32
	MinConns          int32
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
}

// DefaultPoolSettings 返回连接池默认值：
// MaxConns = min(20, max(4, NumCPU))（可用环境变量 PGPOOL_MAX_CONNS 覆盖，
// 见 platform/config），MinConns = 2，连接最长存活 30 分钟、
// 空闲 5 分钟回收、每 30 秒做一次健康检查。
func DefaultPoolSettings() PoolSettings {
	return PoolSettings{
		MaxConns:          defaultPoolMaxConns(),
		MinConns:          2,
		MaxConnLifetime:   30 * time.Minute,
		MaxConnIdleTime:   5 * time.Minute,
		HealthCheckPeriod: 30 * time.Second,
	}
}

func defaultPoolMaxConns() int32 {
	maxConns := runtime.NumCPU()
	if maxConns < 4 {
		maxConns = 4
	}
	if maxConns > 20 {
		maxConns = 20
	}
	return int32(maxConns)
}

func Open(ctx context.Context, databaseURL string, overrides ...PoolSettings) (*pgxpool.Pool, error) {
	settings := DefaultPoolSettings()
	if len(overrides) > 0 {
		settings = overrides[0]
	}
	poolConfig, err := buildPoolConfig(databaseURL, settings)
	if err != nil {
		return nil, err
	}
	// An empty connection string tells pgx to use standard PGHOST/PGPORT/
	// PGUSER/PGPASSWORD/PGDATABASE variables. This avoids URL-escaping secrets.
	return pgxpool.NewWithConfig(ctx, poolConfig)
}

// buildPoolConfig 先用 ParseConfig 保留连接串/PG* 环境变量解析出的
// TLS 等参数，再叠加显式池上限。
func buildPoolConfig(databaseURL string, settings PoolSettings) (*pgxpool.Config, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.MaxConns = settings.MaxConns
	poolConfig.MinConns = settings.MinConns
	poolConfig.MaxConnLifetime = settings.MaxConnLifetime
	poolConfig.MaxConnIdleTime = settings.MaxConnIdleTime
	poolConfig.HealthCheckPeriod = settings.HealthCheckPeriod
	return poolConfig, nil
}
