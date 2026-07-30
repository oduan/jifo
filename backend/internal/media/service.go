package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const DefaultMaxSizeBytes int64 = 10 * 1024 * 1024

var (
	ErrInvalidMIMEType  = errors.New("invalid media mime type")
	ErrInvalidSize      = errors.New("invalid media size")
	ErrFileTooLarge     = errors.New("media file too large")
	ErrChecksumMismatch = errors.New("media checksum mismatch")
	ErrAssetNotFound    = errors.New("media asset not found")
)

type Service struct {
	db           *pgxpool.Pool
	mediaRoot    string
	maxSizeBytes int64
}

type Asset struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Kind       string
	MIMEType   string
	SizeBytes  int64
	StorageKey string
	Checksum   string
	CreatedAt  time.Time
	DeletedAt  *time.Time
	PurgeAfter *time.Time
	PurgedAt   *time.Time
}

type UploadInput struct {
	UserID    uuid.UUID
	Kind      string
	MIMEType  string
	SizeBytes int64
	Checksum  string
	Reader    io.Reader
}

func NewService(db *pgxpool.Pool, mediaRoot string) *Service {
	return &Service{db: db, mediaRoot: mediaRoot, maxSizeBytes: DefaultMaxSizeBytes}
}

func (s *Service) ValidateUpload(mimeType string, size int64) error {
	switch mimeType {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
	default:
		return ErrInvalidMIMEType
	}
	if size <= 0 {
		return ErrInvalidSize
	}
	if size > s.maxSizeBytes {
		return ErrFileTooLarge
	}
	return nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Asset, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, kind, mime_type, size_bytes, storage_key, checksum, created_at, deleted_at, purge_after, purged_at
		FROM media_assets
		WHERE user_id = $1
		  AND deleted_at IS NULL
		  AND purged_at IS NULL
		ORDER BY created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := make([]Asset, 0)
	for rows.Next() {
		asset, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return assets, nil
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID, assetID uuid.UUID) (Asset, error) {
	asset, err := scanAsset(s.db.QueryRow(ctx, `
		SELECT id, user_id, kind, mime_type, size_bytes, storage_key, checksum, created_at, deleted_at, purge_after, purged_at
		FROM media_assets
		WHERE user_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND purged_at IS NULL
	`, userID, assetID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Asset{}, ErrAssetNotFound
	}
	return asset, err
}

func (s *Service) Open(asset Asset) (File, error) {
	return os.Open(filepath.Join(s.mediaRoot, filepath.FromSlash(asset.StorageKey)))
}

func (s *Service) Upload(ctx context.Context, input UploadInput) (Asset, error) {
	if err := s.ValidateUpload(input.MIMEType, input.SizeBytes); err != nil {
		return Asset{}, err
	}

	id := uuid.New()
	storageKey := filepath.ToSlash(filepath.Join(input.UserID.String(), id.String()))
	finalPath := filepath.Join(s.mediaRoot, input.UserID.String(), id.String())
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return Asset{}, err
	}

	tmpPath := finalPath + ".tmp"
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		return Asset{}, err
	}

	h := sha256.New()
	written, copyErr := io.Copy(tmpFile, io.TeeReader(io.LimitReader(input.Reader, input.SizeBytes+1), h))
	closeErr := tmpFile.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return Asset{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return Asset{}, closeErr
	}
	if written != input.SizeBytes {
		_ = os.Remove(tmpPath)
		return Asset{}, errors.New("media size does not match input")
	}

	actualChecksum := hex.EncodeToString(h.Sum(nil))
	checksum := input.Checksum
	if checksum == "" {
		checksum = actualChecksum
	} else if checksum != actualChecksum {
		_ = os.Remove(tmpPath)
		return Asset{}, ErrChecksumMismatch
	}

	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		return Asset{}, err
	}

	asset, err := scanAsset(s.db.QueryRow(ctx, `
		INSERT INTO media_assets (id, user_id, kind, mime_type, size_bytes, storage_key, checksum)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, kind, mime_type, size_bytes, storage_key, checksum, created_at, deleted_at, purge_after, purged_at
	`, id, input.UserID, input.Kind, input.MIMEType, input.SizeBytes, storageKey, checksum))
	if err != nil {
		_ = os.Remove(finalPath)
		return Asset{}, err
	}
	return asset, nil
}

func (s *Service) MarkUnreferencedAssetsForDeletion(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	// 7 天宽限期：给不同步客户端重新引用的机会，避免误删仍被使用的文件。
	_, err := tx.Exec(ctx, `
		UPDATE media_assets ma
		SET deleted_at = COALESCE(ma.deleted_at, now()),
		    purge_after = COALESCE(ma.purge_after, now() + interval '7 days')
		WHERE ma.user_id = $1
		  AND ma.deleted_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM note_media_refs nmr
			WHERE nmr.user_id = ma.user_id AND nmr.media_id = ma.id
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM users u
			WHERE u.id = ma.user_id AND u.avatar_media_id = ma.id
		  )
	`, userID)
	return err
}

func (s *Service) PurgeDueAssets(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `
		SELECT id
		FROM media_assets
		WHERE deleted_at IS NOT NULL
		  AND purged_at IS NULL
		  AND purge_after <= $1
		ORDER BY purge_after, id
		LIMIT 500
	`, now.UTC())
	if err != nil {
		return err
	}
	defer rows.Close()

	due := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		due = append(due, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, id := range due {
		if err := s.purgeDueAsset(ctx, id, now.UTC()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) purgeDueAsset(ctx context.Context, assetID uuid.UUID, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID uuid.UUID
	var storageKey string
	err = tx.QueryRow(ctx, `
		SELECT user_id, storage_key
		FROM media_assets
		WHERE id = $1
		  AND deleted_at IS NOT NULL
		  AND purged_at IS NULL
		  AND purge_after <= $2
		FOR UPDATE
	`, assetID, now).Scan(&userID, &storageKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	var referenced bool
	if err := tx.QueryRow(ctx, `
		SELECT
			EXISTS (SELECT 1 FROM note_media_refs WHERE user_id = $1 AND media_id = $2)
			OR EXISTS (SELECT 1 FROM users WHERE id = $1 AND avatar_media_id = $2)
	`, userID, assetID).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		if _, err := tx.Exec(ctx, `
			UPDATE media_assets
			SET deleted_at = NULL, purge_after = NULL
			WHERE user_id = $1 AND id = $2 AND purged_at IS NULL
		`, userID, assetID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	// The media row remains locked while the file is removed. Note updates
	// acquire the same lock before inserting a reference, so a reference can
	// never commit between this final check and physical deletion.
	path := filepath.Join(s.mediaRoot, filepath.FromSlash(storageKey))
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Warn("purge media file failed", "media_id", assetID, "path", path, "error", err)
		return nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE media_assets
		SET purged_at = $3
		WHERE user_id = $1 AND id = $2 AND purged_at IS NULL
	`, userID, assetID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type assetScanner interface {
	Scan(dest ...any) error
}

func scanAsset(scanner assetScanner) (Asset, error) {
	var asset Asset
	err := scanner.Scan(
		&asset.ID,
		&asset.UserID,
		&asset.Kind,
		&asset.MIMEType,
		&asset.SizeBytes,
		&asset.StorageKey,
		&asset.Checksum,
		&asset.CreatedAt,
		&asset.DeletedAt,
		&asset.PurgeAfter,
		&asset.PurgedAt,
	)
	if err != nil {
		return Asset{}, err
	}
	return asset, nil
}
