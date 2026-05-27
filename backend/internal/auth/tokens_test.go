package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHashPasswordAndVerifyPassword(t *testing.T) {
	password := "correct horse battery staple"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == password {
		t.Fatal("hash must not equal plain password")
	}
	if !VerifyPassword(hash, password) {
		t.Fatal("VerifyPassword should accept correct password")
	}
	if VerifyPassword(hash, "wrong password") {
		t.Fatal("VerifyPassword should reject wrong password")
	}
}

func TestGenerateAndParseAccessTokenRoundTrip(t *testing.T) {
	claims := AccessTokenClaims{
		UserID:     uuid.New(),
		SessionID:  uuid.New(),
		DeviceCode: "ios-phone",
		JWTVersion: 7,
	}

	token, err := GenerateAccessToken("test-secret", time.Hour, claims)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	if token == "" {
		t.Fatal("GenerateAccessToken returned empty token")
	}

	parsed, err := ParseAccessToken("test-secret", token)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}

	if parsed.UserID != claims.UserID {
		t.Fatalf("user id = %s, want %s", parsed.UserID, claims.UserID)
	}
	if parsed.SessionID != claims.SessionID {
		t.Fatalf("session id = %s, want %s", parsed.SessionID, claims.SessionID)
	}
	if parsed.DeviceCode != claims.DeviceCode {
		t.Fatalf("device code = %q, want %q", parsed.DeviceCode, claims.DeviceCode)
	}
	if parsed.JWTVersion != claims.JWTVersion {
		t.Fatalf("jwt version = %d, want %d", parsed.JWTVersion, claims.JWTVersion)
	}
	if parsed.ExpiresAt == nil || !parsed.ExpiresAt.After(time.Now()) {
		t.Fatal("parsed token must have a future expiration time")
	}
}
