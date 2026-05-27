package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
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
)

type Service struct {
	db           *pgxpool.Pool
	mediaRoot    string
	now          func() time.Time
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
	return &Service{db: db, mediaRoot: mediaRoot, now: time.Now, maxSizeBytes: DefaultMaxSizeBytes}
}

func (s *Service) SetNowForTest(now func() time.Time) {
	s.now = now
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
	now := s.now().UTC()
	purgeAfter := now
	_, err := tx.Exec(ctx, `
		UPDATE media_assets ma
		SET deleted_at = COALESCE(ma.deleted_at, $2),
		    purge_after = COALESCE(ma.purge_after, $3)
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
	`, userID, now, purgeAfter)
	return err
}

func (s *Service) PurgeDueAssets(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, storage_key
		FROM media_assets
		WHERE deleted_at IS NOT NULL
		  AND purged_at IS NULL
		  AND purge_after <= $1
	`, now.UTC())
	if err != nil {
		return err
	}
	defer rows.Close()

	type dueAsset struct {
		id         uuid.UUID
		userID     uuid.UUID
		storageKey string
	}
	due := make([]dueAsset, 0)
	for rows.Next() {
		var a dueAsset
		if err := rows.Scan(&a.id, &a.userID, &a.storageKey); err != nil {
			return err
		}
		due = append(due, a)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, asset := range due {
		path := filepath.Join(s.mediaRoot, filepath.FromSlash(asset.storageKey))
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if _, err := s.db.Exec(ctx, `
			UPDATE media_assets
			SET purged_at = $3
			WHERE user_id = $1 AND id = $2 AND purged_at IS NULL
		`, asset.userID, asset.id, now.UTC()); err != nil {
			return err
		}
	}
	return nil
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
