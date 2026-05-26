package httpx

import (
	"encoding/json"
	"testing"
)

func TestAPIErrorShape(t *testing.T) {
	err := NewError("note_not_found", "笔记不存在", "req-1")
	if err.Error.Code != "note_not_found" || err.Error.Message != "笔记不存在" || err.Error.RequestID != "req-1" {
		t.Fatalf("unexpected error shape: %+v", err)
	}
}

func TestAPIErrorJSONShape(t *testing.T) {
	err := NewError("note_not_found", "笔记不存在", "req-1")

	b, marshalErr := json.Marshal(err)
	if marshalErr != nil {
		t.Fatalf("json.Marshal() error = %v", marshalErr)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal(b, &payload); unmarshalErr != nil {
		t.Fatalf("json.Unmarshal() error = %v", unmarshalErr)
	}

	errorObj, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error field should be nested object, got: %#v", payload["error"])
	}
	if _, ok := errorObj["requestId"]; !ok {
		t.Fatalf("requestId key missing in error object: %#v", errorObj)
	}
	if errorObj["code"] != "note_not_found" || errorObj["message"] != "笔记不存在" || errorObj["requestId"] != "req-1" {
		t.Fatalf("unexpected json payload: %#v", payload)
	}
}
