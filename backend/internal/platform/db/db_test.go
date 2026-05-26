package db

import "testing"

func TestOpenRejectsEmptyURL(t *testing.T) {
	_, err := Open(t.Context(), "")
	if err == nil {
		t.Fatal("expected error for empty url")
	}
}
