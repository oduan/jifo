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

const (
	minAccessTokenSecretLength = 16
	refreshTokenReuseGrace     = time.Minute
)

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
}

type LoginInput struct {
	Email      string
	Password   string
	DeviceCode string
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

	result, err := s.createSessionResult(ctx, tx, user, input.DeviceCode)
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
			// 对 dummy hash 做一次等价比对，避免通过响应时间探测 email 是否已注册。
			_ = VerifyPassword(dummyPasswordHash, input.Password)
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if !VerifyPassword(passwordHash, input.Password) {
		return nil, ErrInvalidCredentials
	}

	return s.createSessionResult(ctx, s.db, user, input.DeviceCode)
}

func (s *Service) Logout(ctx context.Context, userID, sessionID uuid.UUID) error {
	if userID == uuid.Nil || sessionID == uuid.Nil {
		return ErrInvalidAccessToken
	}
	result, err := s.db.Exec(ctx, `
		UPDATE user_sessions
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE id = $1 AND user_id = $2
	`, sessionID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrInvalidAccessToken
	}
	return nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	tokenHash := hashRefreshToken(refreshToken)
	var session sessionRow
	var usedAt *time.Time
	var withinReuseGrace bool
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
			u.updated_at,
			rt.used_at,
			COALESCE(rt.reuse_until >= now(), false)
		FROM session_refresh_tokens rt
		JOIN user_sessions s ON s.id = rt.session_id
		JOIN users u ON u.id = s.user_id
		WHERE rt.token_hash = $1
		  AND rt.expires_at > now()
		  AND s.revoked_at IS NULL
		  AND s.expires_at > now()
		FOR UPDATE OF rt, s
	`, tokenHash).Scan(
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
		&usedAt,
		&withinReuseGrace,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidRefreshToken
		}
		return nil, err
	}

	if usedAt != nil && !withinReuseGrace {
		if _, err := tx.Exec(ctx, `UPDATE user_sessions SET revoked_at = now() WHERE id = $1`, session.ID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, ErrInvalidRefreshToken
	}
	if usedAt == nil {
		if _, err := tx.Exec(ctx, `
			UPDATE session_refresh_tokens
			SET used_at = now(), reuse_until = now() + make_interval(secs => $2)
			WHERE token_hash = $1
		`, tokenHash, int(refreshTokenReuseGrace.Seconds())); err != nil {
			return nil, err
		}
	}

	newRefreshToken, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}
	var refreshExpiresAt time.Time
	if err := tx.QueryRow(ctx, `
		UPDATE user_sessions
		SET prev_refresh_token_hash = $1,
		    refresh_token_hash = $2,
		    expires_at = now() + interval '30 days',
		    last_seen_at = now()
		WHERE id = $3
		  AND revoked_at IS NULL
		RETURNING expires_at
	`, tokenHash, hashRefreshToken(newRefreshToken), session.ID).Scan(&refreshExpiresAt); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO session_refresh_tokens (token_hash, session_id, expires_at)
		VALUES ($1, $2, $3)
	`, hashRefreshToken(newRefreshToken), session.ID, refreshExpiresAt); err != nil {
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

func (s *Service) createSessionResult(ctx context.Context, q dbtx, user User, deviceCode string) (*AuthResult, error) {
	refreshToken, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}

	session := sessionRow{UserID: user.ID, DeviceCode: strings.TrimSpace(deviceCode), User: user}
	var refreshExpiresAt time.Time
	err = q.QueryRow(ctx, `
		INSERT INTO user_sessions (user_id, device_code, device_name, refresh_token_hash, last_seen_at, expires_at)
		VALUES ($1, $2, $3, $4, now(), now() + interval '30 days')
		RETURNING id, jwt_version, expires_at
	`, user.ID, session.DeviceCode, generateDeviceName(), hashRefreshToken(refreshToken)).Scan(&session.ID, &session.JWTVersion, &refreshExpiresAt)
	if err != nil {
		return nil, err
	}
	if _, err := q.Exec(ctx, `
		INSERT INTO session_refresh_tokens (token_hash, session_id, expires_at)
		VALUES ($1, $2, $3)
	`, hashRefreshToken(refreshToken), session.ID, refreshExpiresAt); err != nil {
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

func generateDeviceName() string {
	return uuid.NewString()
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
