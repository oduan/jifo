package notes

import (
	"time"

	"github.com/google/uuid"
)

type Block struct {
	Type    string     `json:"type"`
	Text    string     `json:"text,omitempty"`
	MediaID *uuid.UUID `json:"mediaId,omitempty"`
	URL     string     `json:"url,omitempty"`
	Alt     string     `json:"alt,omitempty"`
}

type Content struct {
	Blocks []Block `json:"blocks"`
}

type Note struct {
	ID                   uuid.UUID
	UserID               uuid.UUID
	ClientID             string
	Content              Content
	PlainText            string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	DeletedAt            *time.Time
	PurgeAfter           *time.Time
	PermanentlyDeletedAt *time.Time
	Version              int64
}

type CreateInput struct {
	UserID    uuid.UUID
	ClientID  string
	Content   Content
	PlainText string
}

type UpdateInput struct {
	UserID    uuid.UUID
	NoteID    uuid.UUID
	Content   Content
	PlainText string
}

type ListFilter struct {
	UserID  uuid.UUID
	Trash   bool
	Search  string
	TagPath string
	Limit   int
	Offset  int
}
