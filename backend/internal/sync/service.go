package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/notes"
)

type Service struct {
	db    *pgxpool.Pool
	notes *notes.Service
}

func NewService(db *pgxpool.Pool, noteSvc *notes.Service) *Service {
	return &Service{db: db, notes: noteSvc}
}

type Operation struct {
	OpID        string
	Entity      string
	Action      string
	ClientID    string
	EntityID    *uuid.UUID
	BaseVersion *int64
	Payload     Payload
}

type Payload struct {
	Content   notes.Content `json:"content"`
	PlainText string        `json:"plainText"`
}

type PushResult struct {
	Status  string     `json:"status"`
	NoteID  *uuid.UUID `json:"noteId,omitempty"`
	Version int64      `json:"version,omitempty"`
}

type Cursor struct {
	UpdatedAt time.Time
	ID        uuid.UUID
}

type PullItem struct {
	NoteID    uuid.UUID     `json:"noteId"`
	ClientID  string        `json:"clientId"`
	Content   notes.Content `json:"content"`
	PlainText string        `json:"plainText"`
	Version   int64         `json:"version"`
	UpdatedAt time.Time     `json:"updatedAt"`
	Tombstone string        `json:"tombstone,omitempty"`
	DeletedAt *time.Time    `json:"deletedAt,omitempty"`
	PurgedAt  *time.Time    `json:"purgedAt,omitempty"`
}

type PullResult struct {
	Items      []PullItem `json:"items"`
	NextCursor *Cursor    `json:"nextCursor,omitempty"`
}

func (s *Service) Push(ctx context.Context, userID uuid.UUID, sessionID *uuid.UUID, op Operation) (PushResult, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return PushResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, userID.String(), op.OpID); err != nil {
		return PushResult{}, err
	}

	var existing []byte
	err = tx.QueryRow(ctx, `
		SELECT result_json
		FROM sync_operations
		WHERE user_id = $1 AND op_id = $2
	`, userID, op.OpID).Scan(&existing)
	if err == nil {
		var result PushResult
		if err := json.Unmarshal(existing, &result); err != nil {
			return PushResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return PushResult{}, err
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PushResult{}, err
	}

	result, err := s.applyNewOperationTx(ctx, tx, userID, op)
	if err != nil {
		return PushResult{}, err
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return PushResult{}, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO sync_operations (
			user_id, session_id, op_id, entity, action, entity_id, client_id, base_version, status, result_json
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
	`, userID, sessionID, op.OpID, op.Entity, op.Action, op.EntityID, op.ClientID, op.BaseVersion, result.Status, resultJSON)
	if err != nil {
		return PushResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return PushResult{}, err
	}
	return result, nil
}

func (s *Service) applyNewOperationTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, op Operation) (PushResult, error) {
	if op.Entity != "note" {
		return PushResult{}, fmt.Errorf("unsupported entity: %s", op.Entity)
	}

	switch op.Action {
	case "create":
		note, err := s.notes.CreateTx(ctx, tx, notes.CreateInput{UserID: userID, ClientID: op.ClientID, Content: op.Payload.Content, PlainText: op.Payload.PlainText})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				var existingID uuid.UUID
				var existingVersion int64
				if queryErr := tx.QueryRow(ctx, `SELECT id, version FROM notes WHERE user_id = $1 AND client_id = $2`, userID, op.ClientID).Scan(&existingID, &existingVersion); queryErr != nil {
					return PushResult{}, queryErr
				}
				return PushResult{Status: "duplicate", NoteID: &existingID, Version: existingVersion}, nil
			}
			return PushResult{}, err
		}
		return PushResult{Status: "created", NoteID: &note.ID, Version: note.Version}, nil
	case "update":
		if op.EntityID == nil {
			return PushResult{}, errors.New("entity_id is required for update")
		}
		currentVersion, err := s.currentNoteVersionTx(ctx, tx, userID, *op.EntityID)
		if err != nil {
			return PushResult{}, err
		}
		if op.BaseVersion != nil && *op.BaseVersion != currentVersion {
			return s.createConflictCopyTx(ctx, tx, userID, *op.EntityID, op.Payload)
		}
		updated, err := s.notes.UpdateTx(ctx, tx, notes.UpdateInput{UserID: userID, NoteID: *op.EntityID, Content: op.Payload.Content, PlainText: op.Payload.PlainText})
		if err != nil {
			return PushResult{}, err
		}
		return PushResult{Status: "updated", NoteID: &updated.ID, Version: updated.Version}, nil
	case "delete":
		if op.EntityID == nil {
			return PushResult{}, errors.New("entity_id is required for delete")
		}
		currentVersion, err := s.currentNoteAnyVersionTx(ctx, tx, userID, *op.EntityID)
		if err != nil {
			return PushResult{}, err
		}
		if op.BaseVersion != nil && *op.BaseVersion != currentVersion {
			return PushResult{Status: "delete_conflict_ignored", NoteID: op.EntityID, Version: currentVersion}, nil
		}
		deleted, err := s.notes.MoveToTrashTx(ctx, tx, userID, *op.EntityID)
		if err != nil {
			return PushResult{}, err
		}
		return PushResult{Status: "deleted", NoteID: &deleted.ID, Version: deleted.Version}, nil
	case "restore":
		if op.EntityID == nil {
			return PushResult{}, errors.New("entity_id is required for restore")
		}
		currentVersion, err := s.currentNoteAnyVersionTx(ctx, tx, userID, *op.EntityID)
		if err != nil {
			return PushResult{}, err
		}
		if op.BaseVersion != nil && *op.BaseVersion != currentVersion {
			return s.createConflictCopyTx(ctx, tx, userID, *op.EntityID, op.Payload)
		}
		restored, err := s.notes.RestoreTx(ctx, tx, userID, *op.EntityID)
		if err != nil {
			return PushResult{}, err
		}
		return PushResult{Status: "restored", NoteID: &restored.ID, Version: restored.Version}, nil
	default:
		return PushResult{}, fmt.Errorf("unsupported action: %s", op.Action)
	}
}

func (s *Service) createConflictCopyTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, originalNoteID uuid.UUID, payload Payload) (PushResult, error) {
	conflictContent := notes.Content{Blocks: make([]notes.Block, 0, len(payload.Content.Blocks)+2)}
	conflictContent.Blocks = append(conflictContent.Blocks,
		notes.Block{Type: "paragraph", Text: "这是一条冲突副本，原笔记已在其他设备被更新。"},
		notes.Block{Type: "divider"},
	)
	conflictContent.Blocks = append(conflictContent.Blocks, payload.Content.Blocks...)

	plainText := "这是一条冲突副本，原笔记已在其他设备被更新。\n\n----"
	if payload.PlainText != "" {
		plainText += "\n" + payload.PlainText
	}

	conflictNote, err := s.notes.CreateTx(ctx, tx, notes.CreateInput{
		UserID:    userID,
		ClientID:  "conflict-" + uuid.NewString(),
		Content:   conflictContent,
		PlainText: plainText,
	})
	if err != nil {
		return PushResult{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE notes
		SET conflict_of_note_id = $3,
		    conflict_reason = 'version_conflict'
		WHERE user_id = $1 AND id = $2
	`, userID, conflictNote.ID, originalNoteID); err != nil {
		return PushResult{}, err
	}
	return PushResult{Status: "conflict_copied", NoteID: &conflictNote.ID, Version: conflictNote.Version}, nil
}

func (s *Service) currentNoteVersionTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) (int64, error) {
	var currentVersion int64
	err := tx.QueryRow(ctx, `
		SELECT version
		FROM notes
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND permanently_deleted_at IS NULL
		FOR UPDATE
	`, userID, noteID).Scan(&currentVersion)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, notes.ErrNoteNotFound
		}
		return 0, err
	}
	return currentVersion, nil
}

func (s *Service) currentNoteAnyVersionTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) (int64, error) {
	var currentVersion int64
	err := tx.QueryRow(ctx, `
		SELECT version
		FROM notes
		WHERE user_id = $1
		  AND id = $2
		  AND permanently_deleted_at IS NULL
		FOR UPDATE
	`, userID, noteID).Scan(&currentVersion)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, notes.ErrNoteNotFound
		}
		return 0, err
	}
	return currentVersion, nil
}

func (s *Service) Pull(ctx context.Context, userID uuid.UUID, cursor Cursor, limit int) (PullResult, error) {
	if limit <= 0 {
		limit = 100
	}

	baseSQL := `
		SELECT id, client_id, content, plain_text, updated_at, version, deleted_at, permanently_deleted_at
		FROM notes
		WHERE user_id = $1
	`
	args := []any{userID}

	if !cursor.UpdatedAt.IsZero() {
		baseSQL += ` AND (updated_at, id) > ($2, $3)`
		args = append(args, cursor.UpdatedAt, cursor.ID)
		baseSQL += ` ORDER BY updated_at ASC, id ASC LIMIT $4`
		args = append(args, limit)
	} else {
		baseSQL += ` ORDER BY updated_at ASC, id ASC LIMIT $2`
		args = append(args, limit)
	}

	rows, err := s.db.Query(ctx, baseSQL, args...)
	if err != nil {
		return PullResult{}, err
	}
	defer rows.Close()

	items := make([]PullItem, 0)
	for rows.Next() {
		var item PullItem
		var contentJSON []byte
		if err := rows.Scan(&item.NoteID, &item.ClientID, &contentJSON, &item.PlainText, &item.UpdatedAt, &item.Version, &item.DeletedAt, &item.PurgedAt); err != nil {
			return PullResult{}, err
		}
		if len(contentJSON) > 0 {
			if err := json.Unmarshal(contentJSON, &item.Content); err != nil {
				return PullResult{}, err
			}
		}
		if item.PurgedAt != nil {
			item.Tombstone = "permanent"
		} else if item.DeletedAt != nil {
			item.Tombstone = "trash"
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return PullResult{}, err
	}

	result := PullResult{Items: items}
	if len(items) > 0 {
		last := items[len(items)-1]
		result.NextCursor = &Cursor{UpdatedAt: last.UpdatedAt, ID: last.NoteID}
	}
	return result, nil
}
