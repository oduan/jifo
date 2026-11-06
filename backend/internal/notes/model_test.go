package notes

import (
	"encoding/json"
	"testing"
)

// 已永久删除（scrub）的笔记 Blocks 为 nil，序列化必须输出 "blocks": [] 而不是 null，
// 否则 non-null 客户端（安卓 Moshi）解析整个响应失败，同步游标卡死。
func TestContentMarshalNeverNullBlocks(t *testing.T) {
	cases := []struct {
		name    string
		content Content
	}{
		{"nil blocks (scrubbed tombstone)", Content{Blocks: nil}},
		{"empty blocks", Content{Blocks: []Block{}}},
		{"with blocks", Content{Blocks: []Block{{Type: "paragraph", Text: "hi"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.content)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var probe struct {
				Blocks []Block `json:"blocks"`
			}
			if err := json.Unmarshal(raw, &probe); err != nil {
				t.Fatalf("unmarshal roundtrip: %v", err)
			}
			if probe.Blocks == nil {
				t.Fatalf("blocks serialized as null: %s", raw)
			}
		})
	}
}

// 反序列化兼容性：null 与 [] 都必须能读回。
func TestContentUnmarshalAcceptsNullAndEmpty(t *testing.T) {
	for _, raw := range []string{`{"blocks":null}`, `{"blocks":[]}`, `{}`} {
		var c Content
		if err := json.Unmarshal([]byte(raw), &c); err != nil {
			t.Fatalf("unmarshal %s: %v", raw, err)
		}
	}
}
