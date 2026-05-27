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

	result, err = s.EnsurePathsTx(ctx, tx, userID, paths)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) EnsurePathsTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, paths []string) (map[string]uuid.UUID, error) {
	ordered := uniqueExpandedPaths(paths)
	result := make(map[string]uuid.UUID, len(ordered))
	if len(ordered) == 0 {
		return result, nil
	}

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

	return result, nil
}

func (s *Service) RecountNoteCounts(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tagIDs []uuid.UUID) error {
	seen := make(map[uuid.UUID]struct{}, len(tagIDs))
	unique := make([]uuid.UUID, 0, len(tagIDs))
	for _, id := range tagIDs {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return nil
	}

	for _, tagID := range unique {
		_, err := tx.Exec(ctx, `
			UPDATE tags
			SET note_count = (
				SELECT count(*)::int
				FROM note_tags nt
				JOIN notes n ON n.id = nt.note_id AND n.user_id = nt.user_id
				WHERE nt.user_id = $1
				  AND nt.tag_id = $2
				  AND n.deleted_at IS NULL
				  AND n.permanently_deleted_at IS NULL
			),
			updated_at = now()
			WHERE user_id = $1 AND id = $2
		`, userID, tagID)
		if err != nil {
			return err
		}
	}
	return nil
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
