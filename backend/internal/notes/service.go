package notes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/tags"
)

var ErrNoteNotFound = errors.New("note not found")

type Service struct {
	db   *pgxpool.Pool
	tags *tags.Service
	now  func() time.Time
}

type MediaDeletionMarker interface {
	MarkUnreferencedAssetsForDeletion(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error
}

func NewService(db *pgxpool.Pool, tagSvc *tags.Service) *Service {
	return &Service{db: db, tags: tagSvc, now: time.Now}
}

func (s *Service) SetNowForTest(now func() time.Time) {
	s.now = now
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Note, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Note{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	note, err := s.CreateTx(ctx, tx, input)
	if err != nil {
		return Note{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) CreateTx(ctx context.Context, tx pgx.Tx, input CreateInput) (Note, error) {
	contentJSON, err := json.Marshal(input.Content)
	if err != nil {
		return Note{}, err
	}

	note, err := scanNote(tx.QueryRow(ctx, `
		INSERT INTO notes (user_id, client_id, content, plain_text)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
	`, input.UserID, input.ClientID, contentJSON, input.PlainText))
	if err != nil {
		return Note{}, err
	}

	if err := s.rebuildNoteTags(ctx, tx, input.UserID, note.ID, input.PlainText, nil); err != nil {
		return Note{}, err
	}
	if err := s.rebuildMediaRefs(ctx, tx, input.UserID, note.ID, input.Content); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Note, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Note{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	note, err := s.UpdateTx(ctx, tx, input)
	if err != nil {
		return Note{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) UpdateTx(ctx context.Context, tx pgx.Tx, input UpdateInput) (Note, error) {
	oldTagIDs, err := s.currentTagIDs(ctx, tx, input.UserID, input.NoteID)
	if err != nil {
		return Note{}, err
	}

	contentJSON, err := json.Marshal(input.Content)
	if err != nil {
		return Note{}, err
	}

	note, err := scanNote(tx.QueryRow(ctx, `
		UPDATE notes
		SET content = $3,
		    plain_text = $4,
		    updated_at = now(),
		    version = version + 1
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND permanently_deleted_at IS NULL
		RETURNING id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
	`, input.UserID, input.NoteID, contentJSON, input.PlainText))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNoteNotFound
	}
	if err != nil {
		return Note{}, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM note_tags WHERE user_id = $1 AND note_id = $2`, input.UserID, input.NoteID); err != nil {
		return Note{}, err
	}
	if err := s.rebuildNoteTags(ctx, tx, input.UserID, input.NoteID, input.PlainText, oldTagIDs); err != nil {
		return Note{}, err
	}
	if err := s.rebuildMediaRefs(ctx, tx, input.UserID, input.NoteID, input.Content); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Note{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	note, err := s.MoveToTrashTx(ctx, tx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) MoveToTrashTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) (Note, error) {
	oldTagIDs, err := s.currentTagIDs(ctx, tx, userID, noteID)
	if err != nil {
		return Note{}, err
	}

	now := s.now().UTC()
	purgeAfter := now.Add(30 * 24 * time.Hour)
	note, err := scanNote(tx.QueryRow(ctx, `
		UPDATE notes
		SET deleted_at = $3,
		    purge_after = $4,
		    updated_at = $3,
		    version = version + 1
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND permanently_deleted_at IS NULL
		RETURNING id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
	`, userID, noteID, now, purgeAfter))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNoteNotFound
	}
	if err != nil {
		return Note{}, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM note_tags WHERE user_id = $1 AND note_id = $2`, userID, noteID); err != nil {
		return Note{}, err
	}
	if err := s.tags.RecountNoteCounts(ctx, tx, userID, oldTagIDs); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Note{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	note, err := s.RestoreTx(ctx, tx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) RestoreTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) (Note, error) {
	now := s.now().UTC()
	note, err := scanNote(tx.QueryRow(ctx, `
		UPDATE notes
		SET deleted_at = NULL,
		    purge_after = NULL,
		    updated_at = $3,
		    version = version + 1
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NOT NULL
		  AND permanently_deleted_at IS NULL
		RETURNING id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
	`, userID, noteID, now))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNoteNotFound
	}
	if err != nil {
		return Note{}, err
	}

	if err := s.rebuildNoteTags(ctx, tx, userID, noteID, note.PlainText, nil); err != nil {
		return Note{}, err
	}
	if err := s.rebuildMediaRefs(ctx, tx, userID, noteID, note.Content); err != nil {
		return Note{}, err
	}
	return note, nil
}

func (s *Service) PermanentlyDeleteExpiredTrash(ctx context.Context, userID uuid.UUID, mediaMarker MediaDeletionMarker) (int64, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	count, err := s.PermanentlyDeleteExpiredTrashTx(ctx, tx, userID, mediaMarker)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Service) PermanentlyDeleteExpiredTrashTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mediaMarker MediaDeletionMarker) (int64, error) {
	now := s.now().UTC()
	rows, err := tx.Query(ctx, `
		SELECT id
		FROM notes
		WHERE user_id = $1
		  AND deleted_at IS NOT NULL
		  AND permanently_deleted_at IS NULL
		  AND purge_after <= $2
	`, userID, now)
	if err != nil {
		return 0, err
	}

	noteIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		noteIDs = append(noteIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	for _, noteID := range noteIDs {
		if _, err := tx.Exec(ctx, `
			UPDATE notes
			SET permanently_deleted_at = $3,
			    updated_at = $3,
			    version = version + 1
			WHERE user_id = $1 AND id = $2
		`, userID, noteID, now); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM note_media_refs WHERE user_id = $1 AND note_id = $2`, userID, noteID); err != nil {
			return 0, err
		}
	}

	if len(noteIDs) > 0 && mediaMarker != nil {
		if err := mediaMarker.MarkUnreferencedAssetsForDeletion(ctx, tx, userID); err != nil {
			return 0, err
		}
	}
	return int64(len(noteIDs)), nil
}

func (s *Service) List(ctx context.Context, filter ListFilter) (ListResult, error) {
	queryFilter := filter
	if filter.Limit > 0 {
		queryFilter.Limit = filter.Limit + 1
	}

	sql, args := buildListQuery(queryFilter)
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()

	items := make([]Note, 0)
	for rows.Next() {
		note, err := scanNote(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, note)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, err
	}

	hasMore := false
	if filter.Limit > 0 && len(items) > filter.Limit {
		hasMore = true
		items = items[:filter.Limit]
	}
	return ListResult{Items: items, HasMore: hasMore}, nil
}

func buildListQuery(filter ListFilter) (string, []any) {
	args := []any{filter.UserID}
	argIndex := 2
	conditions := []string{"n.user_id = $1", "n.permanently_deleted_at IS NULL"}

	if filter.Trash {
		conditions = append(conditions, "n.deleted_at IS NOT NULL")
	} else {
		conditions = append(conditions, "n.deleted_at IS NULL")
	}

	if search := strings.TrimSpace(filter.Search); search != "" {
		conditions = append(conditions, fmt.Sprintf("n.plain_text ILIKE $%d", argIndex))
		args = append(args, "%"+search+"%")
		argIndex++
	}

	if tagPath := strings.TrimSpace(filter.TagPath); tagPath != "" {
		conditions = append(conditions, fmt.Sprintf(`EXISTS (
			SELECT 1
			FROM note_tags nt
			JOIN tags t ON t.user_id = nt.user_id AND t.id = nt.tag_id
			WHERE nt.user_id = n.user_id
			  AND nt.note_id = n.id
			  AND (t.path = $%d OR t.path LIKE $%d ESCAPE '\\')
		)`, argIndex, argIndex+1))
		escapedTagPath := escapeLikePattern(tagPath)
		args = append(args, tagPath, escapedTagPath+"/%")
		argIndex += 2
	}

	sql := `
		SELECT n.id, n.user_id, n.client_id, n.content, n.plain_text, n.created_at, n.updated_at, n.deleted_at, n.purge_after, n.permanently_deleted_at, n.version
		FROM notes n
		WHERE ` + strings.Join(conditions, " AND ") + `
		ORDER BY n.created_at DESC, n.id DESC`

	if filter.Limit > 0 {
		sql += fmt.Sprintf(" LIMIT $%d", argIndex)
		args = append(args, filter.Limit)
		argIndex++
	}
	if filter.Offset > 0 {
		sql += fmt.Sprintf(" OFFSET $%d", argIndex)
		args = append(args, filter.Offset)
	}

	return sql, args
}

func escapeLikePattern(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func (s *Service) rebuildNoteTags(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID, plainText string, affected []uuid.UUID) error {
	paths := tags.ExtractTagPaths(plainText)
	tagIDsByPath, err := s.tags.EnsurePathsTx(ctx, tx, userID, paths)
	if err != nil {
		return err
	}

	newTagIDs := make([]uuid.UUID, 0, len(tagIDsByPath))
	for _, path := range paths {
		tagID, ok := tagIDsByPath[path]
		if !ok {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO note_tags (user_id, note_id, tag_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id, note_id, tag_id) DO NOTHING
		`, userID, noteID, tagID); err != nil {
			return err
		}
		newTagIDs = append(newTagIDs, tagID)
	}

	affected = append(affected, newTagIDs...)
	return s.tags.RecountNoteCounts(ctx, tx, userID, affected)
}

func (s *Service) rebuildMediaRefs(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID, content Content) error {
	if _, err := tx.Exec(ctx, `DELETE FROM note_media_refs WHERE user_id = $1 AND note_id = $2`, userID, noteID); err != nil {
		return err
	}

	seen := make(map[uuid.UUID]struct{})
	for _, block := range content.Blocks {
		if block.Type != "image" || block.MediaID == nil || *block.MediaID == uuid.Nil {
			continue
		}
		mediaID := *block.MediaID
		if _, ok := seen[mediaID]; ok {
			continue
		}
		seen[mediaID] = struct{}{}
		if _, err := tx.Exec(ctx, `
			INSERT INTO note_media_refs (user_id, note_id, media_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (note_id, media_id) DO NOTHING
		`, userID, noteID, mediaID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) currentTagIDs(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `SELECT tag_id FROM note_tags WHERE user_id = $1 AND note_id = $2`, userID, noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

type noteScanner interface {
	Scan(dest ...any) error
}

func scanNote(scanner noteScanner) (Note, error) {
	var note Note
	var contentJSON []byte
	err := scanner.Scan(
		&note.ID,
		&note.UserID,
		&note.ClientID,
		&contentJSON,
		&note.PlainText,
		&note.CreatedAt,
		&note.UpdatedAt,
		&note.DeletedAt,
		&note.PurgeAfter,
		&note.PermanentlyDeletedAt,
		&note.Version,
	)
	if err != nil {
		return Note{}, err
	}
	if len(contentJSON) > 0 {
		if err := json.Unmarshal(contentJSON, &note.Content); err != nil {
			return Note{}, err
		}
	}
	return note, nil
}
