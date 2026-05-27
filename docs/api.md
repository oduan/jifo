# Jifo API 文档

Base URL：`http://localhost:8080/api`

所有受保护接口需要：

```http
Authorization: Bearer <accessToken>
```

错误响应统一为 JSON，`requestId` 位于 `error` 内：

```json
{
  "error": {
    "code": "unauthorized",
    "message": "invalid access token",
    "requestId": "..."
  }
}
```

## Auth

### 注册

`POST /auth/register`

请求：

```json
{
  "email": "user@example.com",
  "password": "password123",
  "username": "Oisin",
  "deviceCode": "web-chrome-profile-1",
  "deviceName": "Oisin Laptop"
}
```

响应 `201`：

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "Oisin"
  }
}
```

常见错误：

- `400 bad_request`：JSON 无效或缺少 `email/password/deviceCode`
- `409 email_exists`：邮箱已注册

### 登录

`POST /auth/login`

请求：

```json
{
  "email": "user@example.com",
  "password": "password123",
  "deviceCode": "web-chrome-profile-1",
  "deviceName": "Oisin Laptop"
}
```

响应 `200` 同注册。

常见错误：

- `401 invalid_credentials`

## Notes

### 创建笔记

`POST /notes`

请求：

```json
{
  "clientId": "client-note-001",
  "content": {
    "blocks": [
      { "type": "paragraph", "text": "今天开始写 #思考" },
      { "type": "divider" },
      { "type": "paragraph", "text": "继续补充 #电视剧/电视剧1" }
    ]
  },
  "plainText": "今天开始写 #思考\n\n----\n继续补充 #电视剧/电视剧1"
}
```

响应 `201`：

```json
{
  "item": {
    "id": "uuid",
    "clientId": "client-note-001",
    "plainText": "今天开始写 #思考...",
    "createdAt": "2026-05-27T...Z",
    "updatedAt": "2026-05-27T...Z"
  }
}
```

说明：后端 service 会解析 `plainText` 中的标签并维护 `note_tags` / `tags.note_count`。

### 笔记列表

`GET /notes?search=&tagPath=&trash=&limit=&offset=`

查询参数：

- `search`：按 `plain_text ILIKE` 搜索
- `tagPath`：按标签路径筛选，包含子标签；已对 PostgreSQL `LIKE` 通配符做转义
- `trash`：`true/1/yes` 时查询回收站；默认查询未删除笔记
- `limit` / `offset`：分页

响应 `200`：

```json
{
  "items": [
    {
      "id": "uuid",
      "clientId": "client-note-001",
      "plainText": "今天开始写 #思考...",
      "deletedAt": null,
      "createdAt": "2026-05-27T...Z",
      "updatedAt": "2026-05-27T...Z"
    }
  ]
}
```

## Tags

### 标签列表

`GET /tags`

响应 `200`：

```json
{
  "items": [
    {
      "id": "uuid",
      "userID": "uuid",
      "name": "思考",
      "path": "思考",
      "noteCount": 1
    }
  ]
}
```

### 标签树

`GET /tags/tree`

响应 `200`：

```json
{
  "items": [
    {
      "tag": { "path": "电视剧", "noteCount": 1 },
      "children": [
        { "tag": { "path": "电视剧/电视剧1", "noteCount": 1 }, "children": [] }
      ]
    }
  ]
}
```

实际字段以 Go `tags.TreeNode` JSON 输出为准。

## Heatmap

### 获取热力图

`GET /heatmap?from=2026-05-01&to=2026-05-31`

响应 `200`：

```json
{
  "days": [
    {
      "date": "2026-05-27",
      "createdCount": 2,
      "updatedCount": 1,
      "totalCount": 3
    }
  ]
}
```

说明：按用户隔离，按日期聚合；永久删除笔记不计入。

## Media

### 媒体列表（占位）

`GET /media`

当前响应：

```json
{ "items": [] }
```

本地媒体存储 service 已有基础能力，但 HTTP 上传/读取 handler 尚未完整接入。

## Sync

### Push（占位）

`POST /sync/push`

当前 HTTP handler 返回：

```json
{
  "error": {
    "code": "not_implemented",
    "message": "sync handler not implemented"
  }
}
```

后端 `internal/sync.Service` 已实现 note 操作 push/pull 的核心服务逻辑，包括 `created/updated/deleted/restored/duplicate/conflict_copied/delete_conflict_ignored` 等状态；Web 侧也已实现 IndexedDB outbox 与 sync engine。完整 HTTP handler 可在下一迭代接入。
