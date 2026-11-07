package notes

import (
	"encoding/json"
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

// MarshalJSON 保证 blocks 序列化为 [] 而非 null。
// 永久删除的笔记内容被 scrub 后 Blocks 为 nil，若序列化为
// "blocks": null，会把 non-null 客户端（如安卓 Moshi 的
// ApiNoteContent.blocks）整个响应解析打崩，同步游标随之卡死。
func (c Content) MarshalJSON() ([]byte, error) {
	blocks := c.Blocks
	if blocks == nil {
		blocks = []Block{}
	}
	return json.Marshal(struct {
		Blocks []Block `json:"blocks"`
	}{Blocks: blocks})
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
	// BaseVersion 可选乐观锁：非 nil 时与当前 version 不符则返回 ErrVersionConflict
	// 并拒绝写入，防止 REST/MCP 路径静默覆盖并发修改；nil 时保持原有覆盖行为，
	// 兼容未提供 baseVersion 的既有客户端（web/CLI/sync 均未传时行为不变）。
	BaseVersion *int64
}

type ListFilter struct {
	UserID      uuid.UUID
	Trash       bool
	Search      string
	TagPath     string
	CreatedFrom *time.Time
	CreatedTo   *time.Time
	UpdatedFrom *time.Time
	UpdatedTo   *time.Time
	Limit       int
	Offset      int
	// Keyset 分页游标：非空时按 (created_at, id) < (cursor) 取下一页，优先于 Offset。
	CursorCreatedAt *time.Time
	CursorID        *uuid.UUID
}

type ListResult struct {
	Items   []Note
	HasMore bool
}
