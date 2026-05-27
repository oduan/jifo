package notes

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestBuildListQuerySupportsSearchTagPathTrashAndPagination(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	filter := ListFilter{
		UserID:  userID,
		Trash:   true,
		Search:  "alpha",
		TagPath: "项目",
		Limit:   20,
		Offset:  40,
	}

	sql, args := buildListQuery(filter)

	if !strings.Contains(sql, "n.deleted_at IS NOT NULL") {
		t.Fatalf("sql should include trash filter, got: %s", sql)
	}
	if !strings.Contains(sql, "n.permanently_deleted_at IS NULL") {
		t.Fatalf("sql should exclude permanently deleted notes, got: %s", sql)
	}
	if !strings.Contains(sql, "n.plain_text ILIKE") {
		t.Fatalf("sql should include search condition, got: %s", sql)
	}
	if !strings.Contains(sql, "EXISTS (") || !strings.Contains(sql, "t.path =") || !strings.Contains(sql, "t.path LIKE") {
		t.Fatalf("sql should include tag path parent filter, got: %s", sql)
	}
	if !strings.Contains(sql, "LIMIT") || !strings.Contains(sql, "OFFSET") {
		t.Fatalf("sql should include pagination, got: %s", sql)
	}

	if len(args) != 6 {
		t.Fatalf("args len = %d, want 6", len(args))
	}
	if args[0] != userID {
		t.Fatalf("arg[0] userID = %v, want %v", args[0], userID)
	}
	if args[1] != "%alpha%" {
		t.Fatalf("arg[1] search = %v, want %%alpha%%", args[1])
	}
	if args[2] != "项目" {
		t.Fatalf("arg[2] tag exact = %v, want 项目", args[2])
	}
	if args[3] != "项目/%" {
		t.Fatalf("arg[3] tag prefix = %v, want 项目/%%", args[3])
	}
	if args[4] != 20 || args[5] != 40 {
		t.Fatalf("pagination args = %v, want [20 40]", args[4:])
	}
}
