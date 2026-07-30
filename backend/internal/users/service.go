package users

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jifo/backend/internal/auth"
)

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Profile is the minimal user identity returned by GET /me.
type Profile struct {
	ID       uuid.UUID
	Email    string
	Username string
}

// GetByID loads the current user's identity fields.
func (s *Service) GetByID(ctx context.Context, userID uuid.UUID) (Profile, error) {
	var profile Profile
	err := s.db.QueryRow(ctx, `SELECT id, email, username FROM users WHERE id = $1`, userID).
		Scan(&profile.ID, &profile.Email, &profile.Username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Profile{}, auth.ErrInvalidCredentials
		}
		return Profile{}, err
	}
	return profile, nil
}

func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword string, newPassword string) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var passwordHash string
	err = tx.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&passwordHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrInvalidCredentials
		}
		return err
	}
	if !auth.VerifyPassword(passwordHash, currentPassword) {
		return auth.ErrInvalidCredentials
	}

	newHash, err := auth.HashPassword(newPassword)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $1,
		    updated_at = $2
		WHERE id = $3
	`, newHash, now, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE user_sessions
		SET revoked_at = $1
		WHERE user_id = $2
		  AND revoked_at IS NULL
	`, now, userID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
