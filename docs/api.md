# Jifo API 文档

Base URL：`http://localhost:8080/api`

所有受保护接口需要：

```http
Authorization: Bearer <accessToken>
```

也可以使用设置中生成的访问密钥作为 Bearer token：

```http
Authorization: Bearer <accessKey>
```

访问密钥用于 CLI 或其它程序访问当前用户资源。它与网页登录的 JWT 使用同一个 `Authorization: Bearer ...` 通道；后端会先尝试验证 JWT，失败后再尝试验证访问密钥。访问密钥验证成功后拥有当前用户的受保护 API 访问权限。

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
  "deviceCode": "web-chrome-profile-1"
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

说明：`device_name` 由后端在创建 session 时自动生成 UUID，客户端无需也不应提交设备名称。

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
  "deviceCode": "web-chrome-profile-1"
}
```

响应 `200` 同注册。`device_name` 由后端在创建 session 时自动生成 UUID，客户端无需也不应提交设备名称。

常见错误：

- `401 invalid_credentials`

### 刷新登录令牌

`POST /auth/refresh`

请求：

```json
{
  "refreshToken": "..."
}
```

响应 `200` 同登录，会返回新的 `accessToken` 和轮换后的 `refreshToken`。旧 refresh token 会立即失效。

常见错误：

- `400 bad_request`：JSON 无效或缺少 `refreshToken`
- `401 invalid_refresh_token`：refresh token 无效、已轮换或 session 已撤销

## Settings

### 访问密钥列表

`GET /settings/access-keys`

响应 `200`：

```json
{
  "items": [
    {
      "id": "uuid",
      "label": "Mac CLI",
      "maskedKey": "jifo_abcd••••••••••vwxyz",
      "createdAt": "2026-05-31T00:00:00Z",
      "lastUsedAt": "2026-05-31T01:00:00Z"
    }
  ]
}
```

说明：列表永远只返回打码后的 `maskedKey`，不会返回完整密钥。

### 创建访问密钥

`POST /settings/access-keys`

请求：

```json
{
  "label": "Mac CLI"
}
```

响应 `201`：

```json
{
  "item": {
    "id": "uuid",
    "label": "Mac CLI",
    "maskedKey": "jifo_abcd••••••••••vwxyz",
    "createdAt": "2026-05-31T00:00:00Z"
  },
  "secret": "jifo_abcd..."
}
```

说明：`secret` 只会在创建响应中返回一次。后端只保存密钥 hash，不保存原始密钥；关闭创建结果后无法再次查看完整密钥。

常见错误：

- `400 bad_request`：缺少备注或 JSON 无效

### 删除访问密钥

`DELETE /settings/access-keys/{id}`

响应 `204`，无响应体。

说明：删除访问密钥会立即撤销该密钥；使用该密钥的 CLI 或其它程序会在后续请求中认证失败。后端执行软删除，列表不再返回已撤销密钥。

常见错误：

- `400 bad_request`：无效密钥 ID
- `404 access_key_not_found`：密钥不存在、已撤销，或不属于当前用户

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
    "content": { "blocks": [{ "type": "paragraph", "text": "今天开始写 #思考" }] },
    "plainText": "今天开始写 #思考...",
    "createdAt": "2026-05-27T...Z",
    "updatedAt": "2026-05-27T...Z",
    "version": 1
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
      "content": { "blocks": [{ "type": "paragraph", "text": "今天开始写 #思考" }] },
      "plainText": "今天开始写 #思考...",
      "deletedAt": null,
      "createdAt": "2026-05-27T...Z",
      "updatedAt": "2026-05-27T...Z",
      "version": 1
    }
  ],
  "page": {
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

`hasMore` 表示使用当前筛选条件继续请求 `offset + limit` 是否可能返回下一页。后端通过多取一条记录计算该字段，不执行额外总数统计。

### 笔记统计

`GET /notes/stats`

响应 `200`：

```json
{
  "total": 42
}
```

说明：`total` 是当前用户所有未删除、未永久删除的笔记数，不受 `search` / `tagPath` 等列表筛选条件影响。

### 更新笔记

`PATCH /notes/{id}`（也支持 `PUT /notes/{id}`）

请求：

```json
{
  "content": {
    "blocks": [{ "type": "paragraph", "text": "更新后的 #思考" }]
  },
  "plainText": "更新后的 #思考"
}
```

响应 `200`：

```json
{
  "item": {
    "id": "uuid",
    "clientId": "client-note-001",
    "content": { "blocks": [{ "type": "paragraph", "text": "更新后的 #思考" }] },
    "plainText": "更新后的 #思考",
    "createdAt": "2026-05-27T...Z",
    "updatedAt": "2026-05-30T...Z",
    "version": 2
  }
}
```

常见错误：

- `400 bad_request`：无效 UUID 或 JSON
- `404 note_not_found`

### 移入回收站

`DELETE /notes/{id}`

响应 `200` 返回被移入回收站的 `item`，其中 `deletedAt` 不为空；30 天后可由清理任务永久删除。

### 从回收站恢复

`POST /notes/{id}/restore`

响应 `200` 返回恢复后的 `item`，其中 `deletedAt` 为空。

## Tags

### 标签列表

`GET /tags`

响应 `200`：

```json
{
  "items": [
    {
      "ID": "uuid",
      "Name": "思考",
      "Path": "思考",
      "ParentID": null,
      "Depth": 0,
      "NoteCount": 1
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
      "id": "uuid",
      "name": "电视剧",
      "path": "电视剧",
      "depth": 0,
      "noteCount": 1,
      "children": [
        {
          "id": "uuid",
          "name": "电视剧1",
          "path": "电视剧/电视剧1",
          "parentId": "uuid",
          "depth": 1,
          "noteCount": 1
        }
      ]
    }
  ]
}
```

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

### 上传媒体

`POST /media`

请求类型：`multipart/form-data`

字段：

- `file`：必填，支持 `image/jpeg`、`image/png`、`image/webp`、`image/gif`
- `checksum`：可选，SHA-256 hex；提供时后端会校验

响应 `201`：

```json
{
  "item": {
    "id": "uuid",
    "kind": "image",
    "mimeType": "image/png",
    "sizeBytes": 12345,
    "checksum": "sha256-hex",
    "url": "/api/media/uuid",
    "createdAt": "2026-05-30T...Z"
  }
}
```

常见错误：

- `400 bad_request`：缺少文件或 multipart 格式错误
- `400 invalid_media_size`
- `400 checksum_mismatch`
- `413 file_too_large`
- `415 invalid_media_type`

### 媒体列表

`GET /media`

响应 `200`：

```json
{
  "items": [
    {
      "id": "uuid",
      "kind": "image",
      "mimeType": "image/png",
      "sizeBytes": 12345,
      "checksum": "sha256-hex",
      "url": "/api/media/uuid",
      "createdAt": "2026-05-30T...Z"
    }
  ]
}
```

### 读取媒体

`GET /media/{id}`

按 bearer token 鉴权，只允许读取当前用户自己的媒体。响应体为原始图片二进制，`Content-Type` 为上传时的 MIME type。

## Sync

### Push

`POST /sync/push`

请求：

```json
{
  "operations": [
    {
      "opId": "op-uuid",
      "entity": "note",
      "action": "create",
      "clientId": "client-note-001",
      "noteId": "uuid-for-update-delete-restore",
      "baseVersion": 1,
      "payload": {
        "blocks": [{ "type": "paragraph", "text": "离线创建 #思考" }],
        "plainText": "离线创建 #思考"
      }
    }
  ]
}
```

响应 `200`：

```json
{
  "results": [
    {
      "opId": "op-uuid",
      "status": "created",
      "noteId": "uuid",
      "version": 1
    }
  ]
}
```

`status` 由 `internal/sync.Service` 返回，包括 `created`、`updated`、`deleted`、`restored`、`duplicate`、`conflict_copied`、`delete_conflict_ignored` 等。

### Pull

`GET /sync/pull?updatedAt=&id=&limit=100`

也支持 `POST /sync/pull`：

```json
{
  "cursor": {
    "updatedAt": "2026-05-30T01:00:00Z",
    "id": "uuid"
  },
  "limit": 100
}
```

响应 `200`：

```json
{
  "notes": [
    {
      "id": "uuid",
      "noteId": "uuid",
      "clientId": "client-note-001",
      "content": { "blocks": [{ "type": "paragraph", "text": "同步笔记" }] },
      "plainText": "同步笔记",
      "version": 1,
      "updatedAt": "2026-05-30T01:00:00Z",
      "tombstone": "trash"
    }
  ],
  "cursor": {
    "updatedAt": "2026-05-30T01:00:00Z",
    "id": "uuid"
  },
  "nextCursor": {
    "updatedAt": "2026-05-30T01:00:00Z",
    "id": "uuid"
  }
}
```

说明：`notes` 是 Web sync adapter 友好的响应；`items` 字段同时保留 service 原始条目，方便调试。
