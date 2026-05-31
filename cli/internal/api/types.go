package api

import (
	"encoding/json"
	"time"
)

type Block struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type Content struct {
	Blocks []Block `json:"blocks"`
}

type Note struct {
	ID        string     `json:"id"`
	ClientID  string     `json:"clientId,omitempty"`
	Content   Content    `json:"content,omitempty"`
	PlainText string     `json:"plainText"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	Version   int64      `json:"version"`
}

type NotesResponse struct {
	Items []Note `json:"items"`
}

type NoteResponse struct {
	Item Note `json:"item"`
}

type CreateNoteInput struct {
	ClientID  string  `json:"clientId"`
	Content   Content `json:"content"`
	PlainText string  `json:"plainText"`
}

type ListNotesParams struct {
	Search  string
	TagPath string
	Trash   bool
	Limit   *int
	Offset  *int
}

type Tag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	ParentID  string `json:"parentId,omitempty"`
	Depth     int    `json:"depth"`
	NoteCount int    `json:"noteCount"`
}

func (t *Tag) UnmarshalJSON(data []byte) error {
	type tagAlias Tag
	var lower tagAlias
	if err := json.Unmarshal(data, &lower); err != nil {
		return err
	}
	var upper struct {
		ID        string `json:"ID"`
		Name      string `json:"Name"`
		Path      string `json:"Path"`
		ParentID  string `json:"ParentID"`
		Depth     int    `json:"Depth"`
		NoteCount int    `json:"NoteCount"`
	}
	if err := json.Unmarshal(data, &upper); err != nil {
		return err
	}
	*t = Tag(lower)
	if t.ID == "" {
		t.ID = upper.ID
	}
	if t.Name == "" {
		t.Name = upper.Name
	}
	if t.Path == "" {
		t.Path = upper.Path
	}
	if t.ParentID == "" {
		t.ParentID = upper.ParentID
	}
	if t.Depth == 0 {
		t.Depth = upper.Depth
	}
	if t.NoteCount == 0 {
		t.NoteCount = upper.NoteCount
	}
	return nil
}

type TagsResponse struct {
	Items []Tag `json:"items"`
}

type TagTreeResponse struct {
	Items []TagNode `json:"items"`
}

type TagNode struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	ParentID  string    `json:"parentId,omitempty"`
	Depth     int       `json:"depth"`
	NoteCount int       `json:"noteCount"`
	Children  []TagNode `json:"children,omitempty"`
}
