package cleanup

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/media"
)

const advisoryLockID int64 = 74020260601

type Service struct {
	db     *pgxpool.Pool
	media  *media.Service
	logger *slog.Logger
}

func NewService(db *pgxpool.Pool, mediaService *media.Service, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{db: db, media: mediaService, logger: logger}
}

func (s *Service) Run(ctx context.Context, interval, timeout time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		s.runTimed(ctx, timeout)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) runTimed(parent context.Context, timeout time.Duration) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	started := time.Now()
	count, ran, err := s.RunOnce(ctx, time.Now().UTC())
	if err != nil {
		s.logger.Error("cleanup failed", "error", err, "durationMs", time.Since(started).Milliseconds())
		return
	}
	if ran {
		s.logger.Info("cleanup completed", "permanentlyDeletedNotes", count, "durationMs", time.Since(started).Milliseconds())
	}
}

func (s *Service) RunOnce(ctx context.Context, now time.Time) (int64, bool, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var acquired bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, advisoryLockID).Scan(&acquired); err != nil {
		return 0, false, err
	}
	if !acquired {
		return 0, false, nil
	}

	result, err := tx.Exec(ctx, `
		WITH due AS (
			SELECT id
			FROM notes
			WHERE deleted_at IS NOT NULL
			  AND permanently_deleted_at IS NULL
			  AND purge_after <= $1
			ORDER BY purge_after, id
			LIMIT 500
			FOR UPDATE SKIP LOCKED
		)
		UPDATE notes n
		SET permanently_deleted_at = $1,
		    updated_at = $1,
		    version = version + 1
		FROM due
		WHERE n.id = due.id
	`, now)
	if err != nil {
		return 0, false, err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM note_media_refs nmr
		USING notes n
		WHERE nmr.note_id = n.id
		  AND n.permanently_deleted_at IS NOT NULL
	`); err != nil {
		return 0, false, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE media_assets ma
		SET deleted_at = COALESCE(ma.deleted_at, $1::timestamptz),
		    purge_after = COALESCE(ma.purge_after, $1::timestamptz)
		WHERE ma.deleted_at IS NULL
		  AND ma.created_at <= ($1::timestamptz - interval '24 hours')
		  AND NOT EXISTS (SELECT 1 FROM note_media_refs nmr WHERE nmr.media_id = ma.id)
		  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = ma.id)
	`, now); err != nil {
		return 0, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, false, err
	}
	if s.media != nil {
		if err := s.media.PurgeDueAssets(ctx, now); err != nil {
			return result.RowsAffected(), true, err
		}
	}
	return result.RowsAffected(), true, nil
}
