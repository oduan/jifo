package tags

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type repository struct{}

func newRepository() *repository {
	return &repository{}
}

func (r *repository) upsertTag(ctx context.Context, tx pgx.Tx, userID uuid.UUID, name string, path string, parentID *uuid.UUID, depth int) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
		INSERT INTO tags (user_id, name, path, parent_id, depth)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, path) DO UPDATE
		SET
			name = EXCLUDED.name,
			parent_id = EXCLUDED.parent_id,
			depth = EXCLUDED.depth,
			updated_at = now()
		RETURNING id
	`, userID, name, path, parentID, depth).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}

	return id, nil
}
