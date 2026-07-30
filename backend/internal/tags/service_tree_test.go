package tags

import (
	"testing"

	"github.com/google/uuid"
)

func TestBuildTreeBuildsParentChildHierarchy(t *testing.T) {
	parentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	childID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	grandchildID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	rows := []Tag{
		{ID: parentID, Name: "项目", Path: "项目", Depth: 0, NoteCount: 2},
		{ID: childID, Name: "后端", Path: "项目/后端", ParentID: &parentID, Depth: 1, NoteCount: 1},
		{ID: grandchildID, Name: "数据库", Path: "项目/后端/数据库", ParentID: &childID, Depth: 2, NoteCount: 1},
	}

	tree := buildTree(rows)
	if len(tree) != 1 {
		t.Fatalf("tree roots = %d, want 1", len(tree))
	}
	if tree[0].ID != parentID || len(tree[0].Children) != 1 {
		t.Fatalf("unexpected root node: %#v", tree[0])
	}
	if tree[0].Children[0].ID != childID {
		t.Fatalf("child id = %s, want %s", tree[0].Children[0].ID, childID)
	}
	if len(tree[0].Children[0].Children) != 1 || tree[0].Children[0].Children[0].ID != grandchildID {
		t.Fatalf("grandchild hierarchy missing: %#v", tree[0].Children[0])
	}
}
