package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const minAccessTokenSecretLength = 16

var (
	ErrEmailAlreadyExists       = errors.New("email already exists")
	ErrInvalidCredentials       = errors.New("invalid credentials")
	ErrInvalidRefreshToken      = errors.New("invalid refresh token")
	ErrInvalidAccessToken       = errors.New("invalid access token")
	ErrInvalidAccessTokenSecret = errors.New("invalid access token secret")
)

type Service struct {
	db                *pgxpool.Pool
	accessTokenSecret string
	accessTokenTTL    time.Duration
}

type RegisterInput struct {
	Email      string
	Password   string
	Username   string
	DeviceCode string
	DeviceName string
}

type LoginInput struct {
	Email      string
	Password   string
	DeviceCode string
	DeviceName string
}

type User struct {
	ID            uuid.UUID
	Email         string
	Username      string
	EmailVerified bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type AuthResult struct {
	AccessToken  string
	RefreshToken string
	User         User
}

type dbtx interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type sessionRow struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	DeviceCode string
	JWTVersion int64
	RevokedAt  *time.Time
	User       User
}

func NewService(db *pgxpool.Pool, accessTokenSecret string, accessTokenTTL time.Duration) (*Service, error) {
	accessTokenSecret = strings.TrimSpace(accessTokenSecret)
	if len(accessTokenSecret) < minAccessTokenSecretLength {
		return nil, ErrInvalidAccessTokenSecret
	}
	if accessTokenTTL <= 0 {
		accessTokenTTL = time.Hour
	}
	return &Service{db: db, accessTokenSecret: accessTokenSecret, accessTokenTTL: accessTokenTTL}, nil
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (*AuthResult, error) {
	email := normalizeEmail(input.Email)
	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return nil, err
	}

	username := strings.TrimSpace(input.Username)
	if username == "" {
		username = defaultUsername(email)
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var user User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, username)
		VALUES ($1, $2, $3)
		RETURNING id, email, username, email_verified, created_at, updated_at
	`, email, passwordHash, username).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.EmailVerified,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrEmailAlreadyExists
		}
		return nil, err
	}

	result, err := s.createSessionResult(ctx, tx, user, input.DeviceCode, input.DeviceName)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput) (*AuthResult, error) {
	var user User
	var passwordHash string
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password_hash, username, email_verified, created_at, updated_at
		FROM users
		WHERE email = $1
	`, normalizeEmail(input.Email)).Scan(
		&user.ID,
		&user.Email,
		&passwordHash,
		&user.Username,
		&user.EmailVerified,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if !VerifyPassword(passwordHash, input.Password) {
		return nil, ErrInvalidCredentials
	}

	return s.createSessionResult(ctx, s.db, user, input.DeviceCode, input.DeviceName)
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var session sessionRow
	err = tx.QueryRow(ctx, `
		SELECT
			s.id,
			s.user_id,
			s.device_code,
			s.jwt_version,
			u.id,
			u.email,
			u.username,
			u.email_verified,
			u.created_at,
			u.updated_at
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.refresh_token_hash = $1
		  AND s.revoked_at IS NULL
		FOR UPDATE
	`, hashRefreshToken(refreshToken)).Scan(
		&session.ID,
		&session.UserID,
		&session.DeviceCode,
		&session.JWTVersion,
		&session.User.ID,
		&session.User.Email,
		&session.User.Username,
		&session.User.EmailVerified,
		&session.User.CreatedAt,
		&session.User.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidRefreshToken
		}
		return nil, err
	}

	newRefreshToken, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE user_sessions
		SET refresh_token_hash = $1,
		    last_seen_at = now()
		WHERE id = $2
		  AND revoked_at IS NULL
	`, hashRefreshToken(newRefreshToken), session.ID); err != nil {
		return nil, err
	}

	accessToken, err := s.generateAccessTokenForSession(session)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &AuthResult{
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		User:         session.User,
	}, nil
}

func (s *Service) ValidateAccessToken(ctx context.Context, tokenString string) (*AccessTokenClaims, error) {
	claims, err := ParseAccessToken(s.accessTokenSecret, tokenString)
	if err != nil {
		return nil, ErrInvalidAccessToken
	}

	var dbJWTVersion int64
	var revokedAt *time.Time
	err = s.db.QueryRow(ctx, `
		SELECT jwt_version, revoked_at
		FROM user_sessions
		WHERE id = $1
		  AND user_id = $2
	`, claims.SessionID, claims.UserID).Scan(&dbJWTVersion, &revokedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidAccessToken
		}
		return nil, err
	}
	if revokedAt != nil || dbJWTVersion != claims.JWTVersion {
		return nil, ErrInvalidAccessToken
	}

	return claims, nil
}

func (s *Service) createSessionResult(ctx context.Context, q dbtx, user User, deviceCode string, deviceName string) (*AuthResult, error) {
	refreshToken, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}

	session := sessionRow{UserID: user.ID, DeviceCode: strings.TrimSpace(deviceCode), User: user}
	err = q.QueryRow(ctx, `
		INSERT INTO user_sessions (user_id, device_code, device_name, refresh_token_hash, last_seen_at)
		VALUES ($1, $2, $3, $4, now())
		RETURNING id, jwt_version
	`, user.ID, session.DeviceCode, defaultDeviceName(deviceName), hashRefreshToken(refreshToken)).Scan(&session.ID, &session.JWTVersion)
	if err != nil {
		return nil, err
	}

	accessToken, err := s.generateAccessTokenForSession(session)
	if err != nil {
		return nil, err
	}

	return &AuthResult{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user,
	}, nil
}

func (s *Service) generateAccessTokenForSession(session sessionRow) (string, error) {
	return GenerateAccessToken(s.accessTokenSecret, s.accessTokenTTL, AccessTokenClaims{
		UserID:     session.UserID,
		SessionID:  session.ID,
		DeviceCode: session.DeviceCode,
		JWTVersion: session.JWTVersion,
	})
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func defaultUsername(email string) string {
	if i := strings.IndexByte(email, '@'); i > 0 {
		return email[:i]
	}
	return email
}

func defaultDeviceName(deviceName string) string {
	deviceName = strings.TrimSpace(deviceName)
	if deviceName == "" {
		return "unknown-device"
	}
	return deviceName
}

func generateRefreshToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashRefreshToken(refreshToken string) string {
	sum := sha256.Sum256([]byte(refreshToken))
	return hex.EncodeToString(sum[:])
}
