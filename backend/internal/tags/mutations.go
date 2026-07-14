package tags

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrTagNotFound    = errors.New("tag not found")
	ErrInvalidTagPath = errors.New("invalid tag path")
)

type affectedNote struct {
	ID        uuid.UUID
	Content   []byte
	PlainText string
}

func (s *Service) Rename(ctx context.Context, userID uuid.UUID, tagID uuid.UUID, requestedPath string) error {
	newPath, ok := normalizeTagPath(requestedPath)
	if !ok {
		return ErrInvalidTagPath
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	oldPath, err := tagPathForUpdate(ctx, tx, userID, tagID)
	if err != nil {
		return err
	}
	if oldPath == newPath {
		return tx.Commit(ctx)
	}

	notes, err := loadAffectedNotes(ctx, tx, userID, tagID)
	if err != nil {
		return err
	}
	if err := rewriteNotesAndRebuildTags(ctx, s, tx, userID, tagID, notes, oldPath, newPath); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) Delete(ctx context.Context, userID uuid.UUID, tagID uuid.UUID, deleteNotes bool) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	oldPath, err := tagPathForUpdate(ctx, tx, userID, tagID)
	if err != nil {
		return err
	}
	notes, err := loadAffectedNotes(ctx, tx, userID, tagID)
	if err != nil {
		return err
	}

	if deleteNotes {
		for _, note := range notes {
			if _, err := tx.Exec(ctx, `
				UPDATE notes
				SET deleted_at = now(), purge_after = now() + interval '30 days', updated_at = now(), version = version + 1
				WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL AND permanently_deleted_at IS NULL
			`, userID, note.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM note_tags WHERE user_id = $1 AND note_id = $2`, userID, note.ID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM tags WHERE user_id = $1 AND id = $2`, userID, tagID); err != nil {
			return err
		}
		if err := recountAllTags(ctx, tx, userID); err != nil {
			return err
		}
	} else if err := rewriteNotesAndRebuildTags(ctx, s, tx, userID, tagID, notes, oldPath, ""); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func tagPathForUpdate(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tagID uuid.UUID) (string, error) {
	var path string
	err := tx.QueryRow(ctx, `SELECT path FROM tags WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, tagID).Scan(&path)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTagNotFound
	}
	return path, err
}

func loadAffectedNotes(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tagID uuid.UUID) ([]affectedNote, error) {
	rows, err := tx.Query(ctx, `
		SELECT n.id, n.content, n.plain_text
		FROM notes n
		WHERE n.user_id = $1
		  AND n.deleted_at IS NULL
		  AND n.permanently_deleted_at IS NULL
		  AND EXISTS (
			SELECT 1 FROM note_tags nt
			WHERE nt.user_id = n.user_id AND nt.note_id = n.id AND nt.tag_id = $2
		  )
		FOR UPDATE
	`, userID, tagID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]affectedNote, 0)
	for rows.Next() {
		var note affectedNote
		if err := rows.Scan(&note.ID, &note.Content, &note.PlainText); err != nil {
			return nil, err
		}
		result = append(result, note)
	}
	return result, rows.Err()
}

func rewriteNotesAndRebuildTags(ctx context.Context, service *Service, tx pgx.Tx, userID uuid.UUID, tagID uuid.UUID, notes []affectedNote, oldPath string, newPath string) error {
	for index := range notes {
		plainText := rewriteTagTokens(notes[index].PlainText, oldPath, newPath)
		content, err := rewriteContentTagTokens(notes[index].Content, oldPath, newPath)
		if err != nil {
			return err
		}
		notes[index].PlainText = plainText
		notes[index].Content = content
		if _, err := tx.Exec(ctx, `
			UPDATE notes SET content = $3, plain_text = $4, updated_at = now(), version = version + 1
			WHERE user_id = $1 AND id = $2
		`, userID, notes[index].ID, content, plainText); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM note_tags WHERE user_id = $1 AND note_id = $2`, userID, notes[index].ID); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM tags WHERE user_id = $1 AND id = $2`, userID, tagID); err != nil {
		return err
	}

	for _, note := range notes {
		paths := ExtractTagPaths(note.PlainText)
		ids, err := service.EnsurePathsTx(ctx, tx, userID, paths)
		if err != nil {
			return err
		}
		for _, path := range paths {
			id, exists := ids[path]
			if !exists {
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO note_tags (user_id, note_id, tag_id) VALUES ($1, $2, $3)
				ON CONFLICT (user_id, note_id, tag_id) DO NOTHING
			`, userID, note.ID, id); err != nil {
				return err
			}
		}
	}
	return recountAllTags(ctx, tx, userID)
}

func recountAllTags(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		UPDATE tags t
		SET note_count = (
			SELECT count(*)::integer
			FROM note_tags nt
			JOIN notes n ON n.id = nt.note_id AND n.user_id = nt.user_id
			WHERE nt.user_id = $1 AND nt.tag_id = t.id
			  AND n.deleted_at IS NULL AND n.permanently_deleted_at IS NULL
		), updated_at = $2
		WHERE t.user_id = $1
	`, userID, time.Now().UTC())
	return err
}

func normalizeTagPath(raw string) (string, bool) {
	raw = strings.Trim(strings.TrimSpace(raw), "/")
	if raw == "" || strings.ContainsRune(raw, '#') {
		return "", false
	}
	parts := strings.Split(raw, "/")
	for index, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || strings.IndexFunc(part, unicode.IsSpace) >= 0 {
			return "", false
		}
		parts[index] = part
	}
	return strings.Join(parts, "/"), true
}

func rewriteContentTagTokens(raw []byte, oldPath string, newPath string) ([]byte, error) {
	if len(raw) == 0 {
		return raw, nil
	}
	var content map[string]any
	if err := json.Unmarshal(raw, &content); err != nil {
		return nil, err
	}
	blocks, _ := content["blocks"].([]any)
	for _, value := range blocks {
		block, _ := value.(map[string]any)
		if block["type"] != "paragraph" {
			continue
		}
		for _, key := range []string{"text", "content"} {
			if text, ok := block[key].(string); ok {
				block[key] = rewriteTagTokens(text, oldPath, newPath)
			}
		}
	}
	return json.Marshal(content)
}

func rewriteTagTokens(text string, oldPath string, newPath string) string {
	runes := []rune(text)
	var out strings.Builder
	for index := 0; index < len(runes); {
		if runes[index] != '#' {
			out.WriteRune(runes[index])
			index++
			continue
		}
		start := index
		index++
		tokenStart := index
		for index < len(runes) && !isTagBoundary(runes[index]) {
			index++
		}
		token := string(runes[tokenStart:index])
		if token == oldPath || strings.HasPrefix(token, oldPath+"/") {
			if newPath != "" {
				out.WriteRune('#')
				out.WriteString(newPath)
				out.WriteString(strings.TrimPrefix(token, oldPath))
			}
			continue
		}
		out.WriteString(string(runes[start:index]))
	}
	return out.String()
}
