package db

import "testing"

func TestOpenAllowsEmptyURLForStandardPostgresEnvironment(t *testing.T) {
	pool, err := Open(t.Context(), "")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	pool.Close()
}
