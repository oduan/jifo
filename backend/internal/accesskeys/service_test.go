package accesskeys

import (
	"strings"
	"testing"
)

func TestGenerateSecretHasJifoPrefixAndEnoughEntropy(t *testing.T) {
	secret, err := generateSecret()
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	if !strings.HasPrefix(secret, "jifo_") {
		t.Fatalf("secret should have jifo_ prefix: %s", secret)
	}
	if len(secret) < 25 {
		t.Fatalf("secret too short: %d", len(secret))
	}
}

func TestMaskSecretHidesMiddle(t *testing.T) {
	secret := "jifo_abcdefghijklmnopqrstuvwxyz"
	prefix, suffix, masked := maskSecret(secret)

	if prefix != "jifo_abcd" {
		t.Fatalf("prefix = %q", prefix)
	}
	if suffix != "vwxyz" {
		t.Fatalf("suffix = %q", suffix)
	}
	if strings.Contains(masked, "efghijklmnopqrstu") {
		t.Fatalf("masked key leaked middle: %s", masked)
	}
	if !strings.HasPrefix(masked, prefix) || !strings.HasSuffix(masked, suffix) {
		t.Fatalf("masked key should keep prefix/suffix: %s", masked)
	}
}

func TestHashSecretIsStableAndDoesNotReturnSecret(t *testing.T) {
	secret := "jifo_abcdefghijklmnopqrstuvwxyz"
	first := hashSecret(secret)
	second := hashSecret(secret)

	if first != second {
		t.Fatal("hash should be stable")
	}
	if first == secret || strings.Contains(first, secret) {
		t.Fatal("hash should not contain raw secret")
	}
	if len(first) != 64 {
		t.Fatalf("sha256 hex length = %d", len(first))
	}
}
