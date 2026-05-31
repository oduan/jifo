# Jifo 服务端笔记筛选与分页设计文档

**日期：** 2026-05-31  
**范围：** 将 Web 端笔记搜索、标签筛选与加载更多改为后端接口驱动，并为 `/api/notes` 增加 `hasMore` 分页元信息。  
**技术栈：** Go、PostgreSQL、React、TypeScript、Vitest、Testing Library。  

---

## 1. 目标

当前 Web 端在登录后一次性请求全部笔记，然后在前端完成搜索、标签筛选和滚动加载更多。本次改造目标是：

- Web 端不再一次性加载全部笔记。
- 搜索请求后端 `GET /api/notes?search=...`。
- 标签筛选请求后端 `GET /api/notes?tagPath=...`，并复用后端现有“包含子标签”的查询逻辑。
- 滚动到底继续自动加载更多，但加载更多改为请求下一页 `limit/offset`。
- 后端 `/api/notes` 响应增加 `page.hasMore`，前端用它判断是否继续监听滚动加载。

---

## 2. 当前逻辑

### 2.1 后端

后端 `notes.List` 已支持查询参数：

```http
GET /api/notes?search=&tagPath=&trash=&limit=&offset=
```

当前响应只有：

```json
{
  "items": []
}
```

`buildListQuery` 会按 `created_at DESC, id DESC` 排序，搜索使用 `plain_text ILIKE`，标签筛选使用 `tags.path = tagPath OR tags.path LIKE tagPath + '/%'`。

### 2.2 前端

`App` 当前加载工作区时请求：

```ts
listTagTree(client)
listNotes(client)
loadHeatmap(client)
```

`NotesPage` 内部维护：

- `query`
- `selectedTagId`
- `visibleNoteCount`

并使用 `useMemo` 对 `notes` 做本地筛选与 `slice(0, visibleNoteCount)`。这会导致笔记越多，首次加载越重，也无法利用后端分页。

---

## 3. 后端设计

### 3.1 响应结构

`GET /api/notes` 响应扩展为：

```json
{
  "items": [],
  "page": {
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

兼容性：

- 保留 `items` 字段，现有 CLI 或旧前端仍可读取列表。
- 新增 `page` 字段，不破坏已有响应解析。

### 3.2 `hasMore` 计算

当请求中存在正数 `limit` 时：

1. Service 查询 `limit + 1` 条。
2. 如果返回数量大于 `limit`：
   - `hasMore = true`
   - 对外返回前 `limit` 条。
3. 否则：
   - `hasMore = false`
   - 返回全部查询结果。

当 `limit <= 0` 时：

- 保持当前“不分页”语义。
- `page.limit = 0`
- `page.offset = offset`
- `page.hasMore = false`

这样不需要每次 `COUNT(*)`，避免搜索/标签筛选场景下额外全量计数。

### 3.3 类型变更

后端新增：

```go
type ListResult struct {
    Items   []Note
    HasMore bool
}
```

`HandlerService.List` 从：

```go
List(ctx context.Context, filter ListFilter) ([]Note, error)
```

改为：

```go
List(ctx context.Context, filter ListFilter) (ListResult, error)
```

`Service.List` 内部仍复用 `buildListQuery`。为了实现 `limit + 1`，可以在进入 `buildListQuery` 前复制 filter：

```go
queryFilter := filter
if filter.Limit > 0 {
    queryFilter.Limit = filter.Limit + 1
}
```

返回前再裁剪。

### 3.4 参数校验

当前 handler 对 `limit`、`offset` 只做整数解析。为了前端分页更稳定，本次增加：

- `limit < 0` 返回 `400 bad_request`。
- `offset < 0` 返回 `400 bad_request`。

---

## 4. 前端设计

### 4.1 API 类型

`web/src/features/notes/api.ts` 中 `listNotes` 改为支持：

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

`listNotes(client, options)` 构造 URLSearchParams，只发送有意义参数：

- `trash=true`
- 非空 `search`
- 非空 `tagPath`
- `limit` / `offset` 为数字时发送

### 4.2 App 数据流

`App` 持有服务端筛选分页状态：

- `notes`
- `noteQuery`
- `selectedTagPath`
- `selectedTagId`
- `hasMoreNotes`
- `isLoadingMoreNotes`

常量：

```ts
const NOTES_PAGE_SIZE = 20;
```

初始加载：

1. 请求标签树。
2. 请求第一页笔记：`limit=20&offset=0`。
3. 请求热力图。
4. 设置 `notes` 与 `hasMoreNotes`。

筛选变化：

- 搜索输入变化时，App 记录 `noteQuery`。
- 标签变化时，App 记录 `selectedTagId` 和 `selectedTagPath`。
- 用 300ms debounce 后请求第一页。
- 第一页返回后替换当前 `notes`。

加载更多：

- `NotesPage` 的 sentinel 触发 `onLoadMoreNotes`。
- App 如果 `hasMoreNotes && !isLoadingMoreNotes && !isLoading`，请求：

```ts
limit=20&offset=notes.length&search=currentQuery&tagPath=currentTagPath
```

- 返回后追加到 `notes`。
- 用返回的 `page.hasMore` 更新 `hasMoreNotes`。

### 4.3 NotesPage 组件职责

`NotesPage` 不再本地筛选或本地分页。它只负责：

- 展示传入的 `notes`。
- 展示选中标签标题。
- 输入搜索词时调用 `onSearchChange`。
- 点击标签时调用 `onSelectTag`。
- sentinel 进入视口时调用 `onLoadMoreNotes`。

移除/替换：

- 移除 `noteContains`。
- 移除 `selectedTagIds`。
- 移除 `filteredNotes`。
- 移除 `visibleNoteCount` 和本地 `slice`。

保留：

- 点击正文中的 `#标签` 仍尝试匹配 `path/id/name`，匹配后通过 `onSelectTag` 交给 App。
- `TagTree` 选中态仍由 `selectedTagId` 控制。
- 侧边栏统计仍显示当前已加载 notes 数与标签/热力图信息。

### 4.4 搜索体验

保持“输入即搜索”，但请求由 App debounce 300ms 后发出。用户快速输入时只请求最后一次稳定输入。

当搜索或标签变化时，可继续使用现有 loading banner。若后续需要更精细体验，可以拆分为“首次加载”和“筛选加载中”状态。

---

## 5. 测试策略

### 5.1 后端

- `buildListQuery` 继续测试 search/tag/trash/limit/offset。
- 新增 `Service.List` 测试：当 limit 为 2 且有 3 条匹配时，返回 2 条且 `HasMore=true`。
- 新增 handler 测试：`GET /notes?limit=20&offset=40` 返回 `page.limit=20`、`page.offset=40`、`page.hasMore`。
- 新增 handler 参数校验测试：负数 `limit` 或 `offset` 返回 400。

### 5.2 前端

- `notes/api.test.ts` 增加 `listNotes` 参数构造测试，确认 search/tagPath/limit/offset 进入 URL。
- `NotesPage.test.tsx` 改为验证：搜索输入调用 `onSearchChange`，标签点击调用 `onSelectTag`，sentinel 触发 `onLoadMoreNotes`。
- `App.test.tsx` 增加：
  - 初次加载请求 `/notes?limit=20&offset=0`。
  - 搜索输入后请求 `/notes?search=...&limit=20&offset=0`。
  - `page.hasMore=true` 时滚动触发下一页请求 `/notes?...&offset=20`。

---

## 6. 风险与缓解

### 6.1 响应结构变化影响 CLI

CLI 当前只读取 `items`，新增 `page` 不影响 JSON 解码。后端仍保留 `items` 顶层字段。

### 6.2 快速输入导致请求乱序

如果用户快速输入，旧请求可能比新请求晚返回。实现时为每次第一页加载维护请求序号，只接受最新请求结果；或者通过 effect cleanup 标记过期请求。MVP 使用请求序号即可。

### 6.3 创建/更新/删除后的刷新范围

当前 mutation 后重新加载工作区。改造后 mutation 成功后重新加载当前筛选条件第一页，避免把全部笔记拉回前端。

---

## 7. 验收标准

- 后端 `/api/notes?limit=20&offset=0` 返回 `items` 和 `page.hasMore`。
- Web 初次进入只请求第一页笔记，不再一次性请求所有笔记。
- 搜索会请求后端 `search` 参数。
- 标签筛选会请求后端 `tagPath` 参数。
- 滚动到底时会在 `page.hasMore=true` 时请求下一页并追加展示。
- `page.hasMore=false` 时不再继续加载下一页。
- `cd backend && go test ./...` 通过。
- `cd web && npm test -- --run` 通过。
- `cd web && npm run build` 通过。
