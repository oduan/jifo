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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/tags"
)

var (
	ErrNoteNotFound          = errors.New("note not found")
	ErrVersionConflict       = errors.New("note version conflict")
	ErrMediaAssetUnavailable = errors.New("media asset is unavailable")
)

// tagWriter 是 notes 包对 tag 写入能力的窄接口，解除对 *tags.Service 具体类型的耦合。
type tagWriter interface {
	EnsurePathsTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, paths []string) (map[string]uuid.UUID, error)
	RecountNoteCounts(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tagIDs []uuid.UUID) error
}

type Service struct {
	db   *pgxpool.Pool
	tags tagWriter
}

type MediaDeletionMarker interface {
	MarkUnreferencedAssetsForDeletion(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error
}

func NewService(db *pgxpool.Pool, tagSvc tagWriter) *Service {
	return &Service{db: db, tags: tagSvc}
}

// Create 是 REST/MCP 直连写路径的入口，在 CreateTx 之上做了 (user_id, client_id)
// 唯一约束(23505)的幂等处理：客户端超时重试会复用同一 clientId，此时回读既有行
// 并以 duplicate=true 返回，而不是把唯一冲突当 500 抛给客户端（否则客户端换新
// clientId 重发会产生重复笔记）。
// sync 路径不走这里——它在 applyNewOperationTx 里自行捕获 23505 并返回
// status="duplicate"，CreateTx 因此保持原样返回原始约束错误。
func (s *Service) Create(ctx context.Context, input CreateInput) (Note, bool, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Note{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 用嵌套事务(savepoint)包住插入：INSERT 命中 23505 时先回滚到 savepoint，
	// 外层事务才不会停留在 aborted 状态，随后的回读才可能成功——否则服务端会以
	// 25P02 "current transaction is aborted" 拒绝同一事务里的后续语句。
	// 与 sync 路径 applyNewOperationTx 对 create 操作的处理保持同一模式。
	createTx, err := tx.Begin(ctx)
	if err != nil {
		return Note{}, false, err
	}
	note, err := s.CreateTx(ctx, createTx, input)
	if err != nil {
		_ = createTx.Rollback(ctx)
		// 该写路径上 note_tags/note_media_refs/tags 的插入都带 ON CONFLICT DO NOTHING/UPDATE，
		// 23505 几乎只可能来自 notes(user_id, client_id) 唯一约束；回读既有行确认，
		// 回读不到（约束来自其他列）则保留原始错误。
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, readErr := noteByUserAndClientIDTx(ctx, tx, input.UserID, input.ClientID)
			if readErr == nil {
				return existing, true, nil
			}
		}
		return Note{}, false, err
	}
	if err := createTx.Commit(ctx); err != nil {
		return Note{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Note{}, false, err
	}
	return note, false, nil
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

// lockNoteRow 先对目标笔记行加锁，保证后续“读旧标签→改行→重建标签计数”在并发下串行，
// 避免 tag 计数竞态。
func lockNoteRow(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) error {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM notes WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, noteID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoteNotFound
	}
	return err
}

func (s *Service) UpdateTx(ctx context.Context, tx pgx.Tx, input UpdateInput) (Note, error) {
	if err := lockNoteRow(ctx, tx, input.UserID, input.NoteID); err != nil {
		return Note{}, err
	}
	// 可选乐观锁：行已被 FOR UPDATE 锁定，此刻读到的 version 即最新提交值，
	// 读后比对不会被并发写入插队。与 sync 路径不同，这里冲突时直接报
	// ErrVersionConflict 而不创建冲突副本：REST/MCP 是同步请求-响应，客户端在场，
	// 收到冲突可重新拉取、合并后再试；冲突副本是 sync 异步客户端防数据丢失的策略
	// （客户端可能早已离线，静默丢弃其写入会丢数据），不适用于同步调用方。
	if input.BaseVersion != nil {
		currentVersion, err := noteVersionTx(ctx, tx, input.UserID, input.NoteID)
		if err != nil {
			return Note{}, err
		}
		if *input.BaseVersion != currentVersion {
			return Note{}, ErrVersionConflict
		}
	}
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
	if err := lockNoteRow(ctx, tx, userID, noteID); err != nil {
		return Note{}, err
	}
	oldTagIDs, err := s.currentTagIDs(ctx, tx, userID, noteID)
	if err != nil {
		return Note{}, err
	}

	note, err := scanNote(tx.QueryRow(ctx, `
		UPDATE notes
		SET deleted_at = now(),
		    purge_after = now() + interval '30 days',
		    updated_at = now(),
		    version = version + 1
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND permanently_deleted_at IS NULL
		RETURNING id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
	`, userID, noteID))
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
	if err := lockNoteRow(ctx, tx, userID, noteID); err != nil {
		return Note{}, err
	}
	note, err := scanNote(tx.QueryRow(ctx, `
		UPDATE notes
		SET deleted_at = NULL,
		    purge_after = NULL,
		    updated_at = now(),
		    version = version + 1
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NOT NULL
		  AND permanently_deleted_at IS NULL
		RETURNING id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
	`, userID, noteID))
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
	rows, err := tx.Query(ctx, `
		SELECT id
		FROM notes
		WHERE user_id = $1
		  AND deleted_at IS NOT NULL
		  AND permanently_deleted_at IS NULL
		  AND purge_after <= now()
	`, userID)
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
		// Scrub the body so "permanently deleted" also erases user content;
		// only tombstone metadata is kept for sync clients.
		if _, err := tx.Exec(ctx, `
			UPDATE notes
			SET permanently_deleted_at = now(),
			    updated_at = now(),
			    content = '{"blocks":[]}'::jsonb,
			    plain_text = '',
			    version = version + 1
			WHERE user_id = $1 AND id = $2
		`, userID, noteID); err != nil {
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

func (s *Service) CountActive(ctx context.Context, userID uuid.UUID) (int64, error) {
	var total int64
	if err := s.db.QueryRow(ctx, `
		SELECT count(*)
		FROM notes
		WHERE user_id = $1
		  AND deleted_at IS NULL
		  AND permanently_deleted_at IS NULL
	`, userID).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
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
		conditions = append(conditions, fmt.Sprintf(`n.plain_text ILIKE $%d ESCAPE E'\\'`, argIndex))
		args = append(args, "%"+escapeLikePattern(search)+"%")
		argIndex++
	}

	if tagPath := strings.TrimSpace(filter.TagPath); tagPath != "" {
		conditions = append(conditions, fmt.Sprintf(`EXISTS (
			SELECT 1
			FROM note_tags nt
			JOIN tags t ON t.user_id = nt.user_id AND t.id = nt.tag_id
			WHERE nt.user_id = n.user_id
			  AND nt.note_id = n.id
			  AND (t.path = $%d OR t.path LIKE $%d ESCAPE E'\\')
		)`, argIndex, argIndex+1))
		escapedTagPath := escapeLikePattern(tagPath)
		args = append(args, tagPath, escapedTagPath+"/%")
		argIndex += 2
	}

	if filter.CursorCreatedAt != nil && filter.CursorID != nil {
		// 游标比较用全行形式并把 user_id 等值常量放进行值里：这样能命中
		// idx_notes_user_active_created_id / idx_notes_user_trash_created_id
		// 的 (user_id, created_at, id) 复合前缀，行值比较只留最后两列为范围条件；
		// 语义与只比较 (created_at, id) 等价，因为 user_id 已被 $1 的等值条件固定。
		conditions = append(conditions, fmt.Sprintf("(n.user_id, n.created_at, n.id) < ($1, $%d, $%d)", argIndex, argIndex+1))
		args = append(args, filter.CursorCreatedAt.UTC(), *filter.CursorID)
		argIndex += 2
	}

	for _, timeFilter := range []struct {
		column   string
		operator string
		value    *time.Time
	}{
		{"n.created_at", ">=", filter.CreatedFrom},
		{"n.created_at", "<=", filter.CreatedTo},
		{"n.updated_at", ">=", filter.UpdatedFrom},
		{"n.updated_at", "<=", filter.UpdatedTo},
	} {
		if timeFilter.value == nil {
			continue
		}
		conditions = append(conditions, fmt.Sprintf("%s %s $%d", timeFilter.column, timeFilter.operator, argIndex))
		args = append(args, timeFilter.value.UTC())
		argIndex++
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
	if filter.Offset > 0 && filter.CursorCreatedAt == nil {
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
		// Purging and re-referencing share the media row lock. If a cleanup
		// worker wins first, purged_at makes the reference invalid; if this
		// transaction wins first, cleanup will observe the new reference.
		var valid bool
		if err := tx.QueryRow(ctx, `
			SELECT true
			FROM media_assets
			WHERE user_id = $1 AND id = $2 AND purged_at IS NULL
			FOR UPDATE
		`, userID, mediaID).Scan(&valid); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrMediaAssetUnavailable
			}
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE media_assets
			SET deleted_at = NULL, purge_after = NULL
			WHERE user_id = $1 AND id = $2
		`, userID, mediaID); err != nil {
			return err
		}
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

// noteByUserAndClientIDTx 按 (user_id, client_id) 回读既有笔记（含回收站中的行，
// 与唯一约束的口径一致），供 Create 幂等重试返回 duplicate 时使用。
func noteByUserAndClientIDTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, clientID string) (Note, error) {
	return scanNote(tx.QueryRow(ctx, `
		SELECT id, user_id, client_id, content, plain_text, created_at, updated_at, deleted_at, purge_after, permanently_deleted_at, version
		FROM notes
		WHERE user_id = $1 AND client_id = $2
	`, userID, clientID))
}

// noteVersionTx 在行锁保护下读取当前 version，供 UpdateTx 的可选乐观锁校验使用。
// 过滤条件与 UpdateTx 随后的 UPDATE 语句逐字一致（回收站/永久删除的笔记不可更新），
// 保证"校验通过的行"就是"即将被更新的行"；回收态笔记在此统一返回 ErrNoteNotFound，
// 使带与不带 baseVersion 的 PATCH 错误契约一致（都是 404，而不是 409/404 摇摆）。
func noteVersionTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, noteID uuid.UUID) (int64, error) {
	var version int64
	err := tx.QueryRow(ctx, `
		SELECT version
		FROM notes
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND permanently_deleted_at IS NULL
	`, userID, noteID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNoteNotFound
	}
	return version, err
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
