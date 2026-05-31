package output

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"jifo/cli/internal/api"
)

func TestJSONWritesValidJSON(t *testing.T) {
	var out bytes.Buffer
	if err := JSON(&out, map[string]any{"items": []string{"a"}}); err != nil {
		t.Fatalf("JSON() error = %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(out.Bytes(), &decoded); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, out.String())
	}
}

func TestNotesTableIncludesPreviewAndHeader(t *testing.T) {
	var out bytes.Buffer
	created := time.Date(2026, 5, 31, 9, 10, 0, 0, time.UTC)
	WriteNotes(&out, []api.Note{{ID: "1234567890abcdef", PlainText: "hello\nworld", CreatedAt: created, UpdatedAt: created, Version: 2}})
	got := out.String()
	for _, want := range []string{"ID", "Created", "Version", "12345678", "hello world"} {
		if !strings.Contains(got, want) {
			t.Fatalf("output missing %q:\n%s", want, got)
		}
	}
}

func TestTagsTreeUsesIndentation(t *testing.T) {
	var out bytes.Buffer
	WriteTagTree(&out, []api.TagNode{{Name: "思考", Path: "思考", NoteCount: 2, Children: []api.TagNode{{Name: "子", Path: "思考/子", NoteCount: 1}}}})
	got := out.String()
	if !strings.Contains(got, "思考 (2)") || !strings.Contains(got, "  思考/子 (1)") {
		t.Fatalf("unexpected tree output:\n%s", got)
	}
}
