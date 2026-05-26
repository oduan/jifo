package httpx

import "testing"

func TestAPIErrorShape(t *testing.T) {
	err := NewError("note_not_found", "笔记不存在", "req-1")
	if err.Error.Code != "note_not_found" || err.Error.Message != "笔记不存在" || err.Error.RequestID != "req-1" {
		t.Fatalf("unexpected error shape: %+v", err)
	}
}
