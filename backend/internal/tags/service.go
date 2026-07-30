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

type Tag struct {
	ID        uuid.UUID
	Name      string
	Path      string
	ParentID  *uuid.UUID
	Depth     int
	NoteCount int
}

type TreeNode struct {
	ID        uuid.UUID  `json:"id"`
	Name      string     `json:"name"`
	Path      string     `json:"path"`
	ParentID  *uuid.UUID `json:"parentId,omitempty"`
	Depth     int        `json:"depth"`
	NoteCount int        `json:"noteCount"`
	Children  []TreeNode `json:"children,omitempty"`
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

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Tag, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, path, parent_id, depth, note_count
		FROM tags
		WHERE user_id = $1
		ORDER BY depth ASC, sort_order ASC, path ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Tag, 0)
	for rows.Next() {
		var tag Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.Path, &tag.ParentID, &tag.Depth, &tag.NoteCount); err != nil {
			return nil, err
		}
		result = append(result, tag)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) Tree(ctx context.Context, userID uuid.UUID) ([]TreeNode, error) {
	rows, err := s.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	return buildTree(rows), nil
}

func buildTree(tags []Tag) []TreeNode {
	nodes := make(map[uuid.UUID]TreeNode, len(tags))
	children := make(map[uuid.UUID][]uuid.UUID, len(tags))
	rootIDs := make([]uuid.UUID, 0)
	for _, tag := range tags {
		nodes[tag.ID] = TreeNode{
			ID:        tag.ID,
			Name:      tag.Name,
			Path:      tag.Path,
			ParentID:  tag.ParentID,
			Depth:     tag.Depth,
			NoteCount: tag.NoteCount,
			Children:  make([]TreeNode, 0),
		}
	}

	for _, tag := range tags {
		if tag.ParentID == nil {
			rootIDs = append(rootIDs, tag.ID)
			continue
		}
		_, ok := nodes[*tag.ParentID]
		if !ok {
			rootIDs = append(rootIDs, tag.ID)
			continue
		}
		children[*tag.ParentID] = append(children[*tag.ParentID], tag.ID)
	}

	var materialize func(uuid.UUID, map[uuid.UUID]bool) TreeNode
	materialize = func(id uuid.UUID, ancestors map[uuid.UUID]bool) TreeNode {
		node := nodes[id]
		if ancestors[id] {
			return node
		}
		nextAncestors := make(map[uuid.UUID]bool, len(ancestors)+1)
		for ancestor := range ancestors {
			nextAncestors[ancestor] = true
		}
		nextAncestors[id] = true
		for _, childID := range children[id] {
			if !nextAncestors[childID] {
				node.Children = append(node.Children, materialize(childID, nextAncestors))
			}
		}
		return node
	}

	out := make([]TreeNode, 0, len(rootIDs))
	for _, rootID := range rootIDs {
		out = append(out, materialize(rootID, nil))
	}
	return out
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
