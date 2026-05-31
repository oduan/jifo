# Jifo Server-Side Note Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Web note search, tag filtering, and infinite loading to backend `/api/notes` pagination with explicit `page.hasMore` metadata.

**Architecture:** Extend backend note listing from `[]Note` to `ListResult{Items, HasMore}` by querying `limit + 1` rows when `limit > 0`. Update Web `App` to own server-side filter/page state and make `NotesPage` a presentational component that emits search/tag/load-more events instead of filtering locally.

**Tech Stack:** Go, PostgreSQL/pgx, React, TypeScript, Vitest, Testing Library.

---

## File Structure

- Modify `backend/internal/notes/model.go`: add `ListResult` if model file is the best place for public note service result types.
- Modify `backend/internal/notes/service.go`: return `ListResult`, compute `HasMore` with `limit + 1`.
- Modify `backend/internal/notes/handler.go`: return `page` metadata and reject negative pagination.
- Modify backend tests:
  - `backend/internal/notes/service_test.go`
  - `backend/internal/notes/service_list_query_test.go`
  - add or update handler tests in `backend/internal/notes/handler_test.go` if present; otherwise add focused tests through existing route tests.
- Modify `docs/api.md`: document `page.limit`, `page.offset`, `page.hasMore`.
- Modify `web/src/features/notes/api.ts`: make `listNotes` accept search/tagPath/limit/offset and return `{ items, page }`.
- Modify `web/src/features/notes/api.test.ts`: verify query string construction and DTO parsing.
- Modify `web/src/features/notes/NotesPage.tsx`: remove local filtering/slicing; add controlled search/tag/load-more props.
- Modify `web/src/features/notes/NotesPage.test.tsx`: update expectations for callbacks instead of local filtering.
- Modify `web/src/app/App.tsx`: own note filter/page state, fetch first page on filter changes, append next pages on sentinel.
- Modify `web/src/app/App.test.tsx`: test initial page request, search request, tag request, and load-more request.

---

### Task 1: Backend ListResult and hasMore service behavior

**Files:**
- Modify: `backend/internal/notes/model.go`
- Modify: `backend/internal/notes/service.go`
- Test: `backend/internal/notes/service_test.go`

- [ ] **Step 1: Write failing service pagination test**

Add this test to `backend/internal/notes/service_test.go`:

```go
func TestServiceListReturnsHasMoreWhenLimitHasExtraRow(t *testing.T) {
	db := testutil.OpenDB(t)
	ctx := context.Background()
	tagSvc := tags.NewService(db)
	svc := NewService(db, tagSvc)
	userID := uuid.New()

	for i := 0; i < 3; i++ {
		_, err := svc.Create(ctx, CreateInput{
			UserID:   userID,
			ClientID: fmt.Sprintf("client-%d", i),
			Content:  Content{Blocks: []Block{{Type: "paragraph", Text: fmt.Sprintf("note %d", i)}}},
			PlainText: fmt.Sprintf("note %d", i),
		})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
	}

	result, err := svc.List(ctx, ListFilter{UserID: userID, Limit: 2, Offset: 0})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("items len = %d, want 2", len(result.Items))
	}
	if !result.HasMore {
		t.Fatalf("HasMore = false, want true")
	}

	lastPage, err := svc.List(ctx, ListFilter{UserID: userID, Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("List() last page error = %v", err)
	}
	if len(lastPage.Items) != 1 {
		t.Fatalf("last page len = %d, want 1", len(lastPage.Items))
	}
	if lastPage.HasMore {
		t.Fatalf("last page HasMore = true, want false")
	}
}
```

If imports are missing, add `fmt`, `github.com/google/uuid`, `jifo/backend/internal/platform/testutil`, and `jifo/backend/internal/tags` only if not already present.

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd backend
go test ./internal/notes -run TestServiceListReturnsHasMoreWhenLimitHasExtraRow -v
```

Expected: FAIL because `List` still returns `[]Note` and no `HasMore` field.

- [ ] **Step 3: Add ListResult type**

Add to `backend/internal/notes/model.go` near `ListFilter`:

```go
type ListResult struct {
	Items   []Note
	HasMore bool
}
```

- [ ] **Step 4: Update Service.List implementation**

Change `Service.List` in `backend/internal/notes/service.go` to:

```go
func (s *Service) List(ctx context.Context, filter ListFilter) (ListResult, error) {
	queryFilter := filter
	if filter.Limit > 0 {
		queryFilter.Limit = filter.Limit + 1
	}

	sql, args := buildListQuery(queryFilter)
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()

	items := make([]Note, 0)
	for rows.Next() {
		note, err := scanNote(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, note)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, err
	}

	hasMore := false
	if filter.Limit > 0 && len(items) > filter.Limit {
		hasMore = true
		items = items[:filter.Limit]
	}
	return ListResult{Items: items, HasMore: hasMore}, nil
}
```

- [ ] **Step 5: Update compile errors in other packages minimally**

Where code calls `svc.List` and expects `[]Note`, update to use `.Items` or new result shape. Do not change response JSON yet except what is needed to compile; handler response changes are Task 2.

- [ ] **Step 6: Run notes package tests**

Run:

```bash
cd backend
go test ./internal/notes -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/notes
git commit -m "feat(api): add note list hasMore result" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 2: Backend handler page metadata and pagination validation

**Files:**
- Modify: `backend/internal/notes/handler.go`
- Test: `backend/internal/notes/handler_test.go` or existing handler test file
- Modify: `docs/api.md`

- [ ] **Step 1: Write failing handler tests**

Create `backend/internal/notes/handler_test.go` if it does not exist. Include a fake service and tests:

```go
package notes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeHandlerService struct {
	filter ListFilter
}

func (f *fakeHandlerService) Create(ctx context.Context, input CreateInput) (Note, error) { return Note{}, nil }
func (f *fakeHandlerService) List(ctx context.Context, filter ListFilter) (ListResult, error) {
	f.filter = filter
	return ListResult{
		Items: []Note{{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), ClientID: "c1", PlainText: "hello", CreatedAt: time.Date(2026, 5, 31, 1, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 31, 1, 0, 0, 0, time.UTC), Version: 1}},
		HasMore: true,
	}, nil
}
func (f *fakeHandlerService) Update(ctx context.Context, input UpdateInput) (Note, error) { return Note{}, nil }
func (f *fakeHandlerService) MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error) { return Note{}, nil }
func (f *fakeHandlerService) Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (Note, error) { return Note{}, nil }

func TestHandlerListReturnsPageMetadata(t *testing.T) {
	userID := uuid.New()
	svc := &fakeHandlerService{}
	h := NewHandler(svc)
	req := httptest.NewRequest(http.MethodGet, "/notes?search=hi&tagPath=工作&limit=20&offset=40", nil)
	req = req.WithContext(httpx.WithUserID(req.Context(), userID, uuid.Nil))
	rr := httptest.NewRecorder()

	h.List(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if svc.filter.Search != "hi" || svc.filter.TagPath != "工作" || svc.filter.Limit != 20 || svc.filter.Offset != 40 {
		t.Fatalf("filter = %+v", svc.filter)
	}
	var body struct {
		Items []noteDTO `json:"items"`
		Page  struct {
			Limit   int  `json:"limit"`
			Offset  int  `json:"offset"`
			HasMore bool `json:"hasMore"`
		} `json:"page"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Items) != 1 || body.Page.Limit != 20 || body.Page.Offset != 40 || !body.Page.HasMore {
		t.Fatalf("body = %+v", body)
	}
}

func TestHandlerListRejectsNegativePagination(t *testing.T) {
	h := NewHandler(&fakeHandlerService{})
	for _, target := range []string{"/notes?limit=-1", "/notes?offset=-1"} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req = req.WithContext(httpx.WithUserID(req.Context(), uuid.New(), uuid.Nil))
		rr := httptest.NewRecorder()
		h.List(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", target, rr.Code)
		}
	}
}
```

Add import `jifo/backend/internal/platform/httpx`.

- [ ] **Step 2: Run handler tests to verify failure**

Run:

```bash
cd backend
go test ./internal/notes -run 'TestHandlerList' -v
```

Expected: FAIL because handler does not return `page` and may still use old signature.

- [ ] **Step 3: Update handler service interface and response**

In `backend/internal/notes/handler.go` change:

```go
List(ctx context.Context, filter ListFilter) ([]Note, error)
```

to:

```go
List(ctx context.Context, filter ListFilter) (ListResult, error)
```

Add response DTO:

```go
type pageDTO struct {
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"hasMore"`
}
```

After parsing `limit` and `offset`, add:

```go
if limit < 0 {
	httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid limit")
	return
}
if offset < 0 {
	httpx.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid offset")
	return
}
```

Then update response:

```go
result, err := h.svc.List(...)
...
out := make([]noteDTO, 0, len(result.Items))
for _, item := range result.Items {
	out = append(out, toNoteDTO(item))
}
httpx.WriteJSON(w, http.StatusOK, map[string]any{
	"items": out,
	"page": pageDTO{Limit: limit, Offset: offset, HasMore: result.HasMore},
})
```

- [ ] **Step 4: Document API response**

In `docs/api.md`, update Notes list response example to include:

```json
"page": {
  "limit": 20,
  "offset": 0,
  "hasMore": false
}
```

Add one sentence: `hasMore` 表示使用当前筛选条件继续请求 `offset + limit` 是否可能返回下一页。

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd backend
go test ./...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/notes docs/api.md
git commit -m "feat(api): return note pagination metadata" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 3: Frontend notes API supports server filters and page metadata

**Files:**
- Modify: `web/src/features/notes/api.ts`
- Modify: `web/src/features/notes/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests to `web/src/features/notes/api.test.ts`:

```ts
import { listNotes } from './api';

function fakeClient() {
  const calls: string[] = [];
  return {
    calls,
    client: {
      request: async <T>(path: string): Promise<T> => {
        calls.push(path);
        return { items: [], page: { limit: 20, offset: 40, hasMore: true } } as T;
      }
    }
  };
}

test('listNotes sends server-side filters and pagination params', async () => {
  const { client, calls } = fakeClient();

  const result = await listNotes(client, { search: '会议', tagPath: '工作/会议', limit: 20, offset: 40 });

  expect(calls).toEqual(['/notes?search=%E4%BC%9A%E8%AE%AE&tagPath=%E5%B7%A5%E4%BD%9C%2F%E4%BC%9A%E8%AE%AE&limit=20&offset=40']);
  expect(result.page.hasMore).toBe(true);
});
```

If import conflicts occur, merge with existing imports instead of duplicating.

- [ ] **Step 2: Run the failing frontend API test**

Run:

```bash
cd web
npm test -- --run src/features/notes/api.test.ts
```

Expected: FAIL because `listNotes` currently returns `ApiNote[]` and does not send these params.

- [ ] **Step 3: Update API types and listNotes**

In `web/src/features/notes/api.ts`, replace `ApiListResponse` with exported result types:

```ts
export type ListNotesOptions = {
  trash?: boolean;
  search?: string;
  tagPath?: string;
  limit?: number;
  offset?: number;
};

export type ListNotesResult = {
  items: ApiNote[];
  page: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};
```

Update `listNotes`:

```ts
export async function listNotes(client: ApiClient, options: ListNotesOptions = {}): Promise<ListNotesResult> {
  const params = new URLSearchParams();
  if (options.trash) params.set('trash', 'true');
  if (options.search?.trim()) params.set('search', options.search.trim());
  if (options.tagPath?.trim()) params.set('tagPath', options.tagPath.trim());
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  if (typeof options.offset === 'number') params.set('offset', String(options.offset));
  const response = await client.request<ListNotesResult>(`/notes${params.size ? `?${params.toString()}` : ''}`);
  return {
    items: response.items,
    page: response.page ?? { limit: options.limit ?? 0, offset: options.offset ?? 0, hasMore: false }
  };
}
```

- [ ] **Step 4: Run API tests**

Run:

```bash
cd web
npm test -- --run src/features/notes/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/notes/api.ts web/src/features/notes/api.test.ts
git commit -m "feat(web): support note list query params" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 4: Make NotesPage presentational for server-side filtering

**Files:**
- Modify: `web/src/features/notes/NotesPage.tsx`
- Modify: `web/src/features/notes/NotesPage.test.tsx`

- [ ] **Step 1: Write/update failing NotesPage tests**

Update existing tests that expect local filtering. Replace with callback assertions:

```ts
test('搜索输入交给上层处理而不是本地过滤', async () => {
  const user = userEvent.setup();
  const onSearchChange = vi.fn();

  render(<NotesPage userName="oisin" notes={[{ id: 'n1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '工作笔记' }], tagIds: [] }]} tags={[]} heatmapCells={[]} searchQuery="" onSearchChange={onSearchChange} />);

  await user.type(screen.getByRole('searchbox', { name: '搜索笔记' }), '会议');

  expect(onSearchChange).toHaveBeenLastCalledWith('会议');
  expect(screen.getByText('工作笔记')).toBeInTheDocument();
});

test('点击标签通知上层使用该标签 path 筛选', async () => {
  const user = userEvent.setup();
  const onSelectTag = vi.fn();

  render(<NotesPage userName="oisin" notes={[]} tags={[{ id: 'work', name: '工作', path: '工作', noteCount: 1 }]} heatmapCells={[]} selectedTagId={null} onSelectTag={onSelectTag} />);

  await user.click(screen.getByRole('button', { name: '工作 (1)' }));

  expect(onSelectTag).toHaveBeenCalledWith({ id: 'work', path: '工作' });
});
```

Update the infinite scroll test to pass `hasMoreNotes` and assert `onLoadMoreNotes` called instead of local card count increasing.

- [ ] **Step 2: Run failing NotesPage tests**

Run:

```bash
cd web
npm test -- --run src/features/notes/NotesPage.test.tsx
```

Expected: FAIL because `NotesPage` still owns filtering and local paging state.

- [ ] **Step 3: Update NotesPage props**

In `NotesPageProps`, add controlled props:

```ts
searchQuery?: string;
selectedTagId?: string | null;
hasMoreNotes?: boolean;
isLoadingMoreNotes?: boolean;
onSearchChange?: (query: string) => void;
onSelectTag?: (tag: { id: string | null; path?: string }) => void;
onLoadMoreNotes?: () => void;
```

- [ ] **Step 4: Remove local filtering and slicing**

In `NotesPage.tsx`:

- Remove `noteContains`.
- Remove local `selectedTagId` and `query` states.
- Remove `selectedTagIds`, `filteredNotes`, `visibleNotes`, `visibleNoteCount`.
- Use `notes` directly in render.
- Compute `selectedTag` from controlled `selectedTagId`.
- Search input value becomes `searchQuery`.
- Search input onChange calls `onSearchChange?.(event.target.value)`.
- “全部笔记” click calls `onSelectTag?.({ id: null })`.
- `TagTree onSelect` maps selected ID to tag path and calls `onSelectTag?.({ id, path })`.
- Sentinel renders only when `hasMoreNotes` is true.
- IntersectionObserver calls `onLoadMoreNotes?.()`.

- [ ] **Step 5: Run NotesPage tests**

Run:

```bash
cd web
npm test -- --run src/features/notes/NotesPage.test.tsx
```

Expected: PASS after updating old local-filter expectations.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/notes/NotesPage.tsx web/src/features/notes/NotesPage.test.tsx
git commit -m "feat(web): make notes page server-filtered" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 5: Move note filter and page loading state into App

**Files:**
- Modify: `web/src/app/App.tsx`
- Modify: `web/src/app/App.test.tsx`

- [ ] **Step 1: Write failing App tests**

Extend `web/src/app/App.test.tsx` to collect requested URLs and assert:

```ts
expect(requestedUrls).toContain('/api/notes?limit=20&offset=0');
```

Add a search test:

```ts
test('搜索笔记时请求后端 search 参数', async () => {
  // authenticate, render App, type 会议 into searchbox
  // waitFor requested URL to include /notes?search=...
});
```

Add a load-more test with mocked IntersectionObserver:

```ts
test('滚动到底时根据 hasMore 请求下一页', async () => {
  // first /notes returns 20 items and page.hasMore=true
  // trigger observer
  // expect second notes request includes offset=20
});
```

Keep tests focused on URLs and visible appended note content.

- [ ] **Step 2: Run failing App tests**

Run:

```bash
cd web
npm test -- --run src/app/App.test.tsx
```

Expected: FAIL because App still requests `/notes` without pagination and does not own filter state.

- [ ] **Step 3: Implement App note query/page state**

In `App.tsx`:

Add constants/state:

```ts
const NOTES_PAGE_SIZE = 20;

const [noteQuery, setNoteQuery] = useState('');
const [debouncedNoteQuery, setDebouncedNoteQuery] = useState('');
const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
const [selectedTagPath, setSelectedTagPath] = useState<string | undefined>();
const [hasMoreNotes, setHasMoreNotes] = useState(false);
const [isLoadingMoreNotes, setLoadingMoreNotes] = useState(false);
```

Add debounce effect:

```ts
useEffect(() => {
  const timer = window.setTimeout(() => setDebouncedNoteQuery(noteQuery), 300);
  return () => window.clearTimeout(timer);
}, [noteQuery]);
```

Add helper:

```ts
const noteListOptions = useCallback((offset: number) => ({
  search: debouncedNoteQuery,
  tagPath: selectedTagPath,
  limit: NOTES_PAGE_SIZE,
  offset
}), [debouncedNoteQuery, selectedTagPath]);
```

Update `loadWorkspace` to fetch first page with `noteListOptions(0)` and set `hasMoreNotes(nextNotes.page.hasMore)`.

Add `loadMoreNotes`:

```ts
const loadMoreNotes = useCallback(async () => {
  if (!authStore.getAccessToken() || isLoading || isLoadingMoreNotes || !hasMoreNotes) return;
  setLoadingMoreNotes(true);
  setError(null);
  try {
    const next = await listNotes(client, noteListOptions(notes.length));
    setNotes((current) => [...current, ...next.items.map((note) => fromApiNote(note, tags))]);
    setHasMoreNotes(next.page.hasMore);
  } catch (loadError) {
    setError(errorMessage(loadError));
  } finally {
    setLoadingMoreNotes(false);
  }
}, [client, hasMoreNotes, isLoading, isLoadingMoreNotes, noteListOptions, notes.length, tags]);
```

Pass controlled props to `NotesPage`.

- [ ] **Step 4: Handle filter changes**

Make `loadWorkspace` depend on `debouncedNoteQuery` and `selectedTagPath`, so first page reloads when filters change. Ensure mutation refresh reloads the current first page, not all notes.

When logging out, clear note query, selected tag, and pagination state.

- [ ] **Step 5: Run App tests**

Run:

```bash
cd web
npm test -- --run src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/App.tsx web/src/app/App.test.tsx
git commit -m "feat(web): load notes with server pagination" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

### Task 6: Full verification and cleanup

**Files:**
- No expected source changes unless tests reveal necessary fixes.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend
go test ./...
```

Expected: PASS.

- [ ] **Step 2: Run web tests**

Run:

```bash
cd web
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Run web build**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run CLI tests for response compatibility**

Run:

```bash
cd cli
go test ./...
```

Expected: PASS. This verifies added `page` response metadata does not break CLI JSON decoding.

- [ ] **Step 5: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree.

---

## Self-Review

- Spec coverage: backend `hasMore`, negative pagination validation, Web server-side search/tag filtering, infinite-scroll next page loading, API docs, and verification are covered.
- Placeholder scan: no TBD/TODO placeholders are intentionally left.
- Type consistency: `ListResult`, `ListNotesResult`, page metadata, and controlled `NotesPage` props are introduced before dependent tasks.
- TDD: each production task starts with failing tests and explicit verification commands.
