package notes

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestBuildListQuerySupportsSearchTagPathTrashAndPagination(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	createdFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	updatedTo := time.Date(2026, 6, 30, 23, 59, 59, 0, time.UTC)
	filter := ListFilter{
		UserID:      userID,
		Trash:       true,
		Search:      "alpha",
		TagPath:     "项目",
		CreatedFrom: &createdFrom,
		UpdatedTo:   &updatedTo,
		Limit:       20,
		Offset:      40,
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
	if !strings.Contains(sql, "n.created_at >=") || !strings.Contains(sql, "n.updated_at <=") {
		t.Fatalf("sql should include time range filters, got: %s", sql)
	}

	if len(args) != 8 {
		t.Fatalf("args len = %d, want 8", len(args))
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
	if args[4] != createdFrom.UTC() || args[5] != updatedTo.UTC() {
		t.Fatalf("time args = %v, want [%v %v]", args[4:6], createdFrom.UTC(), updatedTo.UTC())
	}
	if args[6] != 20 || args[7] != 40 {
		t.Fatalf("pagination args = %v, want [20 40]", args[6:])
	}
}

func TestBuildListQueryEscapesTagPathLikeWildcards(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	sql, args := buildListQuery(ListFilter{UserID: userID, TagPath: `项目%_\A`})

	if !strings.Contains(sql, `LIKE $3 ESCAPE E'\\'`) {
		t.Fatalf("sql should use an explicit single-character PostgreSQL ESCAPE for tag LIKE, got: %s", sql)
	}
	if len(args) != 3 {
		t.Fatalf("args len = %d, want 3", len(args))
	}
	if args[1] != `项目%_\A` {
		t.Fatalf("exact tag arg = %q, want unescaped exact path", args[1])
	}
	if args[2] != `项目\%\_\\A/%` {
		t.Fatalf("prefix tag arg = %q, want escaped wildcard prefix", args[2])
	}
}
