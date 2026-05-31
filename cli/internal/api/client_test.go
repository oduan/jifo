package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListNotesSendsAuthAndQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/notes" {
			t.Fatalf("path = %q, want /api/notes", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q", got)
		}
		q := r.URL.Query()
		if q.Get("search") != "hello" || q.Get("tagPath") != "思考" || q.Get("trash") != "true" || q.Get("limit") != "20" || q.Get("offset") != "40" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"note-1","plainText":"hello #思考","version":1}]}`))
	}))
	defer server.Close()

	limit, offset := 20, 40
	client := NewClient(server.URL+"/api", "secret", server.Client())
	resp, err := client.ListNotes(context.Background(), ListNotesParams{Search: "hello", TagPath: "思考", Trash: true, Limit: &limit, Offset: &offset})
	if err != nil {
		t.Fatalf("ListNotes() error = %v", err)
	}
	if len(resp.Items) != 1 || resp.Items[0].ID != "note-1" {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestCreateNoteSendsExpectedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/notes" {
			t.Fatalf("method/path = %s %s", r.Method, r.URL.Path)
		}
		var body CreateNoteInput
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if !strings.HasPrefix(body.ClientID, "cli-") {
			t.Fatalf("ClientID = %q, want cli- prefix", body.ClientID)
		}
		if body.PlainText != "new note #tag" {
			t.Fatalf("PlainText = %q", body.PlainText)
		}
		if len(body.Content.Blocks) != 1 || body.Content.Blocks[0].Type != "paragraph" || body.Content.Blocks[0].Text != body.PlainText {
			t.Fatalf("Content = %+v", body.Content)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"item":{"id":"note-2","plainText":"new note #tag","version":1}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL+"/api", "secret", server.Client())
	resp, err := client.CreateTextNote(context.Background(), "new note #tag")
	if err != nil {
		t.Fatalf("CreateTextNote() error = %v", err)
	}
	if resp.Item.ID != "note-2" {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestListTagsAndTree(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"items":[{"ID":"1","Name":"思考","Path":"思考","NoteCount":2}]}`))
		case "/api/tags/tree":
			_, _ = w.Write([]byte(`{"items":[{"id":"1","name":"思考","path":"思考","noteCount":2,"children":[{"id":"2","name":"子","path":"思考/子","noteCount":1}]}]}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := NewClient(server.URL+"/api", "secret", server.Client())
	tags, err := client.ListTags(context.Background())
	if err != nil {
		t.Fatalf("ListTags() error = %v", err)
	}
	if tags.Items[0].Path != "思考" || tags.Items[0].NoteCount != 2 {
		t.Fatalf("tags = %+v", tags)
	}
	tree, err := client.TagTree(context.Background())
	if err != nil {
		t.Fatalf("TagTree() error = %v", err)
	}
	if tree.Items[0].Children[0].Path != "思考/子" {
		t.Fatalf("tree = %+v", tree)
	}
}

func TestAPIErrorIncludesCodeMessageAndRequestID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"invalid access token","requestId":"req-1"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL+"/api", "secret", server.Client())
	_, err := client.ListTags(context.Background())
	if err == nil {
		t.Fatal("ListTags() error = nil, want error")
	}
	for _, want := range []string{"unauthorized", "invalid access token", "req-1"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q missing %q", err.Error(), want)
		}
	}
}
