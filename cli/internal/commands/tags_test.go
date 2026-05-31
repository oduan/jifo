package commands

import (
	"context"
	"strings"
	"testing"

	"jifo/cli/internal/api"
	"jifo/cli/internal/config"
)

type fakeTagsAPI struct{}

func (f fakeTagsAPI) ListNotes(ctx context.Context, params api.ListNotesParams) (api.NotesResponse, error) {
	return api.NotesResponse{}, nil
}
func (f fakeTagsAPI) CreateTextNote(ctx context.Context, text string) (api.NoteResponse, error) {
	return api.NoteResponse{}, nil
}
func (f fakeTagsAPI) ListTags(ctx context.Context) (api.TagsResponse, error) {
	return api.TagsResponse{Items: []api.Tag{{Path: "思考", NoteCount: 2}}}, nil
}
func (f fakeTagsAPI) TagTree(ctx context.Context) (api.TagTreeResponse, error) {
	return api.TagTreeResponse{Items: []api.TagNode{{Path: "思考", NoteCount: 2, Children: []api.TagNode{{Path: "思考/子", NoteCount: 1}}}}}, nil
}

func TestTagsListJSON(t *testing.T) {
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil },
		NewAPI:     func(cfg config.Config) API { return fakeTagsAPI{} },
	}, "tags", "list", "--json")
	if err != nil {
		t.Fatalf("tags list error = %v output=%s", err, out)
	}
	if !strings.Contains(out, `"items"`) || !strings.Contains(out, "思考") || strings.Contains(out, "Path\t") {
		t.Fatalf("unexpected output:\n%s", out)
	}
}

func TestTagsTreeHumanOutput(t *testing.T) {
	out, err := executeForTest(t, Options{
		LoadConfig: func() (config.Config, error) { return config.Config{AccessToken: "token"}, nil },
		NewAPI:     func(cfg config.Config) API { return fakeTagsAPI{} },
	}, "tags", "tree")
	if err != nil {
		t.Fatalf("tags tree error = %v output=%s", err, out)
	}
	if !strings.Contains(out, "思考 (2)") || !strings.Contains(out, "  思考/子 (1)") {
		t.Fatalf("unexpected output:\n%s", out)
	}
}
