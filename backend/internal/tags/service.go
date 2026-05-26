package tags

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db   *pgxpool.Pool
	repo *repository
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db, repo: newRepository()}
}

func (s *Service) EnsurePaths(ctx context.Context, userID uuid.UUID, paths []string) (map[string]uuid.UUID, error) {
	ordered := uniqueExpandedPaths(paths)
	result := make(map[string]uuid.UUID, len(ordered))
	if len(ordered) == 0 {
		return result, nil
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	for _, path := range ordered {
		parts := strings.Split(path, "/")
		name := parts[len(parts)-1]
		depth := len(parts) - 1

		var parentID *uuid.UUID
		if depth > 0 {
			parentPath := strings.Join(parts[:len(parts)-1], "/")
			pid, ok := result[parentPath]
			if !ok {
				return nil, fmt.Errorf("parent path %q is not ensured", parentPath)
			}
			parentID = &pid
		}

		id, err := s.repo.upsertTag(ctx, tx, userID, name, path, parentID, depth)
		if err != nil {
			return nil, err
		}
		result[path] = id
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func uniqueExpandedPaths(paths []string) []string {
	seen := make(map[string]struct{})
	ordered := make([]string, 0)

	for _, raw := range paths {
		for _, path := range expandPath(strings.TrimSpace(raw)) {
			if _, ok := seen[path]; ok {
				continue
			}
			seen[path] = struct{}{}
			ordered = append(ordered, path)
		}
	}

	return ordered
}
