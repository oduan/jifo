package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	// An empty connection string tells pgx to use standard PGHOST/PGPORT/
	// PGUSER/PGPASSWORD/PGDATABASE variables. This avoids URL-escaping secrets.
	return pgxpool.New(ctx, databaseURL)
}
