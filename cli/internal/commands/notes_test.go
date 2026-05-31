package commands

import (
	"context"
	"strings"
	"testing"
	"time"

	"jifo/cli/internal/api"
	"jifo/cli/internal/config"
)

type fakeNotesAPI struct {
	listParams  api.ListNotesParams
	createdText string
}

func (f *fakeNotesAPI) ListNotes(ctx context.Context, params api.ListNotesParams) (api.NotesResponse, error) {
	f.listParams = params
	created := time.Date(2026, 5, 31, 9, 10, 0, 0, time.UTC)
	return api.NotesResponse{Items: []api.Note{{ID: "1234567890", PlainText: "hello #tag", CreatedAt: created, UpdatedAt: created, Version: 1}}}, nil
}
func (f *fakeNotesAPI) CreateTextNote(ctx context.Context, text string) (api.NoteResponse, error) {
	f.createdText = text
	created := time.Date(2026, 5, 31, 9, 10, 0, 0, time.UTC)
	return api.NoteResponse{Item: api.Note{ID: "created-note", PlainText: text, CreatedAt: created, UpdatedAt: created, Version: 1}}, nil
}
func (f *fakeNotesAPI) ListTags(ctx context.Context) (api.TagsResponse, error) { return api.TagsResponse{}, nil }
func (f *fakeNotesAPI) TagTree(ctx context.Context) (api.TagTreeResponse, error) { return api.TagTreeResponse{}, nil }

func TestNotesListPassesFiltersAndWritesJSON(t *testing.T) {
	fake := &fakeNotesAPI{}
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) {
			return config.Config{BaseURL: "http://x/api", AccessToken: "token", TokenSource: config.TokenSourceConfig}, nil
		},
		NewAPI: func(cfg config.Config) API { return fake },
	}, "notes", "list", "--search", "hello", "--tag", "思考", "--trash", "--limit", "20", "--offset", "40", "--json")
	if err != nil {
		t.Fatalf("notes list error = %v output=%s", err, out)
	}
	if fake.listParams.Search != "hello" || fake.listParams.TagPath != "思考" || !fake.listParams.Trash || *fake.listParams.Limit != 20 || *fake.listParams.Offset != 40 {
		t.Fatalf("params = %+v", fake.listParams)
	}
	if !strings.Contains(out, `"items"`) || strings.Contains(out, "Preview") {
		t.Fatalf("unexpected json output:\n%s", out)
	}
}

func TestNotesListRejectsNegativePagination(t *testing.T) {
	_, err := executeForTest(t, Options{LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil }}, "notes", "list", "--limit", "-1")
	if err == nil || !strings.Contains(err.Error(), "--limit must be >= 0") {
		t.Fatalf("err = %v", err)
	}
}

func TestNotesCreateRequiresExactlyOneInput(t *testing.T) {
	_, err := executeForTest(t, Options{LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil }}, "notes", "create")
	if err == nil || !strings.Contains(err.Error(), "provide exactly one") {
		t.Fatalf("err = %v", err)
	}
}

func TestNotesCreateText(t *testing.T) {
	fake := &fakeNotesAPI{}
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{BaseURL: "http://x/api", AccessToken: "token"}, nil },
		NewAPI:     func(cfg config.Config) API { return fake },
	}, "notes", "create", "--text", "new note #tag", "--json")
	if err != nil {
		t.Fatalf("notes create error = %v output=%s", err, out)
	}
	if fake.createdText != "new note #tag" {
		t.Fatalf("createdText = %q", fake.createdText)
	}
	if !strings.Contains(out, `"item"`) || !strings.Contains(out, "new note #tag") {
		t.Fatalf("unexpected output:\n%s", out)
	}
}
