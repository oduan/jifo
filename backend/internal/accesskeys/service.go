package accesskeys

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidAccessKey  = errors.New("invalid access key")
	ErrInvalidLabel      = errors.New("invalid access key label")
	ErrAccessKeyNotFound = errors.New("access key not found")
)

type Service struct {
	db *pgxpool.Pool
}

type AccessKey struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Label      string
	MaskedKey  string
	CreatedAt  time.Time
	LastUsedAt *time.Time
	RevokedAt  *time.Time
}

type CreateResult struct {
	AccessKey AccessKey
	Secret    string
}

type Principal struct {
	UserID uuid.UUID
	KeyID  uuid.UUID
}

type dbtx interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]AccessKey, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, label, masked_key, created_at, last_used_at, revoked_at
		FROM access_keys
		WHERE user_id = $1
		  AND revoked_at IS NULL
		ORDER BY created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AccessKey, 0)
	for rows.Next() {
		var item AccessKey
		if err := rows.Scan(&item.ID, &item.UserID, &item.Label, &item.MaskedKey, &item.CreatedAt, &item.LastUsedAt, &item.RevokedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, label string) (CreateResult, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return CreateResult{}, ErrInvalidLabel
	}

	for attempt := 0; attempt < 3; attempt++ {
		secret, err := generateSecret()
		if err != nil {
			return CreateResult{}, err
		}
		prefix, suffix, masked := maskSecret(secret)
		var item AccessKey
		err = s.db.QueryRow(ctx, `
			INSERT INTO access_keys (user_id, label, key_hash, key_prefix, key_suffix, masked_key)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, user_id, label, masked_key, created_at, last_used_at, revoked_at
		`, userID, label, hashSecret(secret), prefix, suffix, masked).Scan(
			&item.ID,
			&item.UserID,
			&item.Label,
			&item.MaskedKey,
			&item.CreatedAt,
			&item.LastUsedAt,
			&item.RevokedAt,
		)
		if err == nil {
			return CreateResult{AccessKey: item, Secret: secret}, nil
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			return CreateResult{}, err
		}
	}
	return CreateResult{}, errors.New("generate unique access key failed")
}

func (s *Service) Revoke(ctx context.Context, userID uuid.UUID, keyID uuid.UUID) error {
	if userID == uuid.Nil || keyID == uuid.Nil {
		return ErrAccessKeyNotFound
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE access_keys
		SET revoked_at = now()
		WHERE user_id = $1
		  AND id = $2
		  AND revoked_at IS NULL
	`, userID, keyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAccessKeyNotFound
	}
	return nil
}

func (s *Service) Validate(ctx context.Context, rawKey string) (Principal, error) {
	rawKey = strings.TrimSpace(rawKey)
	if rawKey == "" {
		return Principal{}, ErrInvalidAccessKey
	}

	var principal Principal
	err := s.db.QueryRow(ctx, `
		UPDATE access_keys
		SET last_used_at = now()
		WHERE key_hash = $1
		  AND revoked_at IS NULL
		RETURNING id, user_id
	`, hashSecret(rawKey)).Scan(&principal.KeyID, &principal.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Principal{}, ErrInvalidAccessKey
		}
		return Principal{}, err
	}
	return principal, nil
}

func generateSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return "jifo_" + strings.ToLower(encoded), nil
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func maskSecret(secret string) (string, string, string) {
	prefixLen := 9
	suffixLen := 5
	if len(secret) < prefixLen+suffixLen {
		return secret, secret, secret
	}
	prefix := secret[:prefixLen]
	suffix := secret[len(secret)-suffixLen:]
	return prefix, suffix, prefix + "••••••••••" + suffix
}
