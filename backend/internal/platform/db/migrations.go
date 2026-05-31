package db

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const migrationAdvisoryLockID int64 = 74020260531

type migrationFile struct {
	Version string
	Path    string
	SQL     string
}

// RunMigrations executes SQL migrations from backend/migrations in filename order.
// It only uses schema_migrations records to decide whether a migration has run;
// it does not infer or adopt existing schemas from old environments.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("database pool is required")
	}

	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	if _, err := pool.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationAdvisoryLockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationAdvisoryLockID)
	}()

	files, err := loadMigrationFiles(resolveMigrationsDir())
	if err != nil {
		return err
	}

	for _, file := range files {
		if err := applyMigration(ctx, pool, file); err != nil {
			return err
		}
	}
	return nil
}

func applyMigration(ctx context.Context, pool *pgxpool.Pool, file migrationFile) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", file.Version, err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var alreadyApplied bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, file.Version).Scan(&alreadyApplied); err != nil {
		return fmt.Errorf("check migration %s: %w", file.Version, err)
	}
	if alreadyApplied {
		return nil
	}

	if _, err := tx.Exec(ctx, file.SQL); err != nil {
		return fmt.Errorf("execute migration %s: %w", file.Version, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, file.Version); err != nil {
		return fmt.Errorf("record migration %s: %w", file.Version, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration %s: %w", file.Version, err)
	}
	return nil
}

func resolveMigrationsDir() string {
	if configured := strings.TrimSpace(os.Getenv("JIFO_MIGRATIONS_DIR")); configured != "" {
		return configured
	}

	candidates := []string{}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "migrations"),
			filepath.Join(wd, "backend", "migrations"),
		)
	}
	if _, file, _, ok := runtime.Caller(0); ok {
		candidates = append(candidates, filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations"))
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return "migrations"
}

func loadMigrationFiles(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir %s: %w", dir, err)
	}

	files := make([]migrationFile, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, err := migrationVersion(entry.Name())
		if err != nil {
			return nil, err
		}
		path := filepath.Join(dir, entry.Name())
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		files = append(files, migrationFile{Version: version, Path: path, SQL: string(content)})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Version < files[j].Version
	})
	return files, nil
}

func migrationVersion(filename string) (string, error) {
	base := filepath.Base(filename)
	if !strings.HasSuffix(base, ".sql") {
		return "", fmt.Errorf("migration file must end with .sql: %s", filename)
	}
	version := strings.TrimSuffix(base, ".sql")
	if version == "" || strings.ContainsAny(version, `/\\`) {
		return "", fmt.Errorf("invalid migration version: %s", filename)
	}
	return version, nil
}
