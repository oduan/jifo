# Jifo Flomo-like MVP 设计文档

**日期：** 2026-05-26  
**范围：** 首版实现后端与 Web 端；Android 与 iOS 仅预留目录和 API 兼容方向。  
**技术栈：** Go、PostgreSQL、React、IndexedDB、本地磁盘媒体存储。  

---

## 1. 目标

Jifo 是一个类似 Flomo 的多端笔记应用。首版目标是完成一个可用、可扩展、支持离线基础同步的 Web + 后端闭环：

- 用户可注册、登录、修改资料、修改密码。
- 用户之间数据严格隔离。
- 支持文字笔记、图片 + 文字笔记、仅图片笔记。
- 笔记内容采用块结构 JSON，支持图文混排。
- 从笔记文本中自动提取标签，支持嵌套标签。
- 支持按父标签筛选其自身及所有子标签下的笔记。
- 支持标签置顶、排序、搜索、计数。
- 支持回收站，删除后 30 天内可恢复，超过 30 天后标记为永久删除且不可恢复。
- 超过 30 天永久删除后，关联媒体进入同步清理流程，最终清理本地磁盘文件和媒体元数据。
- 支持热力图，展示最近一段时间每天创建和修改的笔记数量。
- 支持 Web 离线基础能力：离线新增、编辑、删除，恢复网络后自动同步。
- 同步冲突不让用户选择，而是自动创建冲突副本。

---

## 2. 首版范围

### 2.1 首版包含

- Go 后端 API。
- PostgreSQL 数据库。
- React Web 前端。
- 后端本地磁盘媒体存储。
- JWT 用户认证。
- 多设备 session。
- IndexedDB 离线队列。
- 标签树和标签筛选。
- 回收站与永久删除标记。
- 热力图。
- 基础同步机制。

### 2.2 首版暂缓

- Android 端实现。
- iOS 端实现。
- Redis。
- SMTP 邮箱验证。
- 视频和任意二进制文件的高级预览。
- 复杂 CRDT/OT 实时协同编辑。
- 对象存储接入。

---

## 3. Monorepo 目录结构

```text
jifo/
  backend/
    cmd/
      api/
    internal/
      auth/
      users/
      notes/
      tags/
      media/
      sync/
      heatmap/
      platform/
    migrations/
    storage/
      media/
  web/
    src/
      app/
      features/
        auth/
        notes/
        tags/
        media/
        sync/
        settings/
        heatmap/
      shared/
      storage/
  android/
  ios/
  docs/
    superpowers/
      specs/
      plans/
```

### 3.1 后端模块职责

- `auth`：注册、登录、JWT、refresh token、session、设备识别、密码修改后的全端登出。
- `users`：用户资料、用户名、头像、密码修改。
- `notes`：笔记 CRUD、块结构内容、回收站、恢复、永久删除标记。
- `tags`：标签解析、标签 upsert、标签树、置顶、排序、计数、筛选。
- `media`：媒体上传、本地磁盘存储、媒体元数据、访问鉴权、媒体清理。
- `sync`：客户端 outbox 同步、幂等操作、增量拉取、冲突副本。
- `heatmap`：按日期聚合创建和修改数量。
- `platform`：数据库、配置、日志、中间件、错误响应、事务工具。

### 3.2 前端模块职责

- `auth`：登录、注册、token refresh、当前用户状态。
- `notes`：笔记输入、展示、编辑、删除、恢复、折叠展开。
- `tags`：标签树、标签搜索、排序、置顶、标签筛选。
- `media`：图片选择、预览、上传、本地 blob 暂存。
- `sync`：离线 outbox、同步状态、冲突副本结果处理。
- `settings`：偏好设置浮层、头像、用户名、密码修改。
- `heatmap`：多行日历格热力图。
- `storage`：IndexedDB 封装。

---

## 4. 数据模型

### 4.1 用户表 `users`

字段：

- `id`
- `email`
- `password_hash`
- `username`
- `avatar_media_id`
- `email_verified`
- `created_at`
- `updated_at`

约束：

- `email` 唯一。
- 首版 `email_verified` 默认为 `false`，不阻塞登录。

### 4.2 用户会话表 `user_sessions`

字段：

- `id`
- `user_id`
- `device_code`
- `device_name`
- `refresh_token_hash`
- `jwt_version`
- `revoked_at`
- `last_seen_at`
- `created_at`

行为：

- 一个用户可登录多台设备。
- 每台设备有独立 `device_code` 和 session。
- 修改密码后撤销该用户所有 session。
- Refresh token 只保存 hash。

### 4.3 笔记表 `notes`

字段：

- `id`
- `user_id`
- `client_id`
- `content`，JSONB 块结构内容。
- `plain_text`，用于搜索和标签提取。
- `created_at`
- `updated_at`
- `deleted_at`
- `purge_after`
- `permanently_deleted_at`
- `version`
- `conflict_of_note_id`
- `conflict_reason`

约束与索引：

- `notes(user_id, client_id)` 唯一，用于离线 create 幂等。
- `notes(user_id, updated_at, id)` 支持同步增量拉取。
- `notes(user_id, deleted_at, purge_after)` 支持回收站查询和过期处理。
- `notes(user_id, permanently_deleted_at)` 支持隐藏永久删除笔记。

查询规则：

- 普通笔记：`deleted_at IS NULL AND permanently_deleted_at IS NULL`。
- 回收站：`deleted_at IS NOT NULL AND permanently_deleted_at IS NULL`。
- 用户不可见笔记：`permanently_deleted_at IS NOT NULL`。

### 4.4 媒体表 `media_assets`

字段：

- `id`
- `user_id`
- `kind`
- `mime_type`
- `size_bytes`
- `storage_key`
- `checksum`
- `created_at`
- `deleted_at`
- `purge_after`
- `purged_at`

行为：

- 文件保存在后端本地磁盘，例如 `backend/storage/media/{user_id}/{media_id}`。
- 数据库保存元数据和 `storage_key`。
- 媒体访问必须鉴权，不能直接暴露静态目录。
- 当关联笔记永久删除后，媒体进入清理流程。
- 清理完成后设置 `purged_at`，并删除本地磁盘文件。

### 4.5 笔记媒体引用表 `note_media_refs`

字段：

- `note_id`
- `media_id`
- `user_id`
- `created_at`

行为：

- 保存笔记内容块中引用的媒体。
- 笔记进入回收站时可以保留媒体引用，因为 30 天内可恢复。
- 笔记永久删除后，删除对应引用，并将无引用媒体加入清理候选。

### 4.6 标签表 `tags`

字段：

- `id`
- `user_id`
- `name`，当前节点名，例如 `电视剧1`。
- `path`，完整路径，例如 `电视剧/电视剧1`。
- `parent_id`
- `depth`
- `note_count`
- `pinned`
- `sort_order`
- `created_at`
- `updated_at`

约束与索引：

- `tags(user_id, path)` 唯一。
- `tags(user_id, parent_id, sort_order)` 支持标签树排序。
- `note_count = 0` 的标签默认不展示，但数据库保留。

### 4.7 笔记标签关联表 `note_tags`

字段：

- `note_id`
- `tag_id`
- `user_id`
- `created_at`

约束：

- `note_tags(user_id, note_id, tag_id)` 唯一。

行为：

- 笔记进入回收站时立即删除 `note_tags` 关联。
- 笔记恢复时重新从 `plain_text` 解析标签并重建关联。
- 标签计数只统计未删除、未永久删除的笔记。

### 4.8 同步操作表 `sync_operations`

字段：

- `id`
- `user_id`
- `session_id`
- `op_id`
- `entity`
- `action`
- `entity_id`
- `client_id`
- `base_version`
- `status`
- `result_json`
- `created_at`

约束：

- `sync_operations(user_id, op_id)` 唯一。

行为：

- 保证客户端重试时幂等。
- 如果 `op_id` 已处理，直接返回已记录结果。

---

## 5. 笔记内容结构

首版使用块结构 JSON：

```json
{
  "blocks": [
    { "type": "paragraph", "text": "#思考 今天看到一个很好看的电视剧" },
    { "type": "image", "mediaId": "media-id" },
    { "type": "paragraph", "text": "很喜欢这个角色。" }
  ]
}
```

支持块类型：

- `paragraph`
- `image`
- `divider`

`plain_text` 由后端根据 blocks 派生：

- `paragraph.text` 进入 `plain_text`。
- `divider` 导出为 `----`。
- `image` 可导出为空文本或媒体占位描述。

---

## 6. 标签解析、并发与筛选

### 6.1 标签解析规则

- 标签以 `#` 开始。
- 标签内容遇到空格、换行、明显标点边界结束。
- `/` 表示层级。
- `#电视剧/电视剧1` 会生成或复用：
  - `电视剧`
  - `电视剧/电视剧1`
- 同一条笔记内重复标签只计一次。

### 6.2 新增或编辑笔记

后端在一个数据库事务中完成：

1. 创建或更新 note。
2. 从 `plain_text` 提取标签路径。
3. 对每个路径创建缺失的父级和子级标签。
4. 重建该笔记的 `note_tags` 关联。
5. 对受影响标签重新计算 `note_count`。
6. 增加 note `version`。
7. 返回更新后的 note。

并发策略：

- 依赖 `tags(user_id, path)` 唯一约束防止重复标签。
- 创建标签使用 `INSERT ... ON CONFLICT`。
- `note_tags` 重建与 note 更新在同一事务内完成。
- `note_count` 不用简单 `+1/-1`，而是对受影响标签做局部重算，避免竞态错误。

### 6.3 删除笔记进入回收站

在一个事务中：

1. 设置 `deleted_at = now()`。
2. 设置 `purge_after = now() + interval '30 days'`。
3. 删除该笔记的 `note_tags` 关联。
4. 对受影响标签重新计算 `note_count`。
5. 增加 note `version`。

效果：

- 回收站里的笔记不出现在任何标签筛选结果中。
- 标签计数立即减少。
- `note_count = 0` 的标签默认隐藏，但数据库保留。

### 6.4 恢复笔记

在一个事务中：

1. 清空 `deleted_at`。
2. 清空 `purge_after`。
3. 从 `plain_text` 重新解析标签。
4. 重建 `note_tags`。
5. 重算相关标签计数。
6. 增加 note `version`。

### 6.5 超过 30 天后的永久删除标记

后台任务处理 `purge_after < now()` 的回收站笔记：

1. 设置 `permanently_deleted_at = now()`。
2. 笔记从回收站消失。
3. 用户不可恢复该笔记。
4. 删除或标记清理该笔记的 `note_media_refs`。
5. 无引用媒体进入清理候选。
6. 同步拉取时可返回 tombstone，让其他设备移除本地可见数据。

### 6.6 标签筛选

选择父标签 `电视剧` 时，返回：

- 包含 `电视剧` 的笔记。
- 包含 `电视剧/任意子标签` 的笔记。

首版查询策略：

1. 根据 `tags.path = '电视剧' OR tags.path LIKE '电视剧/%'` 找到子树 tag IDs。
2. 通过 `note_tags` 查出 note IDs。
3. 查询 `notes` 时始终带 `user_id`、`deleted_at IS NULL`、`permanently_deleted_at IS NULL`。
4. 排序按 `notes.created_at DESC, notes.id DESC`。

后续标签规模变大时，可增加 `tag_closure(ancestor_id, descendant_id)`。

---

## 7. 同步机制

### 7.1 Web 本地 IndexedDB

保存：

- `notes_cache`：服务端笔记缓存。
- `media_cache`：本地待上传媒体和服务端媒体引用。
- `outbox`：待同步操作队列。
- `sync_state`：最后同步 cursor。

### 7.2 outbox 操作格式

```json
{
  "opId": "client-generated-uuid",
  "entity": "note",
  "action": "create|update|delete|restore",
  "clientId": "note-client-id",
  "baseVersion": 3,
  "payload": {},
  "createdAt": "2026-05-26T13:00:00Z"
}
```

### 7.3 Push 同步

客户端调用 `POST /api/sync/push`。

服务端处理：

- `opId` 已处理时，直接返回之前结果。
- `create` 使用 `client_id` 去重，避免重复创建。
- `update/delete/restore` 检查 `baseVersion`。
- 成功后 note `version + 1`。
- 记录 `sync_operations`。

### 7.4 冲突副本策略

当客户端提交 `update` 或 `restore`，且 `baseVersion < server.version`：

- 不覆盖原笔记。
- 不让用户选择。
- 直接创建一条普通新笔记作为冲突副本。
- 新笔记设置 `conflict_of_note_id` 指向原笔记。
- 新笔记设置 `conflict_reason = 'version_conflict'`。
- 新笔记正常解析标签、参与搜索、参与列表展示。

冲突副本内容前面自动插入提示和分割线：

```text
这是一条冲突副本，原笔记已在其他设备被更新。

----
原本后提交的笔记内容
```

块结构表示：

```json
{
  "blocks": [
    {
      "type": "paragraph",
      "text": "这是一条冲突副本，原笔记已在其他设备被更新。"
    },
    {
      "type": "divider"
    },
    {
      "type": "paragraph",
      "text": "原本后提交的笔记内容"
    }
  ]
}
```

当客户端提交落后的 `delete`，且 `baseVersion < server.version`：

- 不删除服务端当前笔记。
- 不创建冲突副本。
- 返回 `delete_conflict_ignored`。
- Web 端显示轻量 toast：`一条删除操作因笔记已在其他设备更新而被忽略。`

### 7.5 Pull 同步

客户端调用 `GET /api/sync/pull?cursor=...&limit=...`。

返回：

- cursor 之后变更过的 notes。
- 进入回收站的 note tombstone。
- 永久删除标记的 note tombstone。
- 新 cursor。

cursor 首版使用 `(updated_at, id)` 组合。后续可演进为单调递增 `change_seq`。

### 7.6 媒体同步

- 在线插入图片时，先上传到 `POST /api/media`，拿到 `mediaId`，再保存 note。
- 离线插入图片时，IndexedDB 暂存 blob。
- 恢复网络后，同步器先上传媒体，再提交 note 操作。
- 如果笔记永久删除导致媒体无引用，服务端媒体清理任务删除本地文件并更新媒体状态。

---

## 8. 回收站与媒体清理

### 8.1 用户删除笔记

- 笔记进入回收站。
- 30 天内可恢复。
- 立即移除标签关联。
- 标签计数立即更新。
- 媒体引用暂时保留，因为用户仍可恢复笔记。

### 8.2 超过 30 天

后台任务将笔记标记为永久删除：

- 设置 `permanently_deleted_at`。
- 用户不可见、不可恢复。
- 同步 tombstone 给其他设备。
- 删除该笔记的媒体引用。
- 将无引用媒体设置 `deleted_at` 和 `purge_after`。

### 8.3 媒体同步清理

媒体清理任务处理无引用媒体：

1. 查找 `deleted_at IS NOT NULL AND purged_at IS NULL AND purge_after < now()` 的媒体。
2. 删除本地磁盘文件。
3. 设置 `purged_at = now()`。
4. 保留最小元数据记录，便于同步和排错。

---

## 9. API 设计

### 9.1 Auth / User

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`
- `PATCH /api/me`
- `POST /api/me/avatar`
- `POST /api/me/password`

### 9.2 Notes

- `GET /api/notes`
  - 支持分页、搜索、标签筛选、回收站筛选。
- `POST /api/notes`
- `GET /api/notes/{id}`
- `PATCH /api/notes/{id}`
- `DELETE /api/notes/{id}`
  - 进入回收站。
- `POST /api/notes/{id}/restore`

### 9.3 Tags

- `GET /api/tags/tree`
- `GET /api/tags`
- `PATCH /api/tags/{id}`
  - 置顶、排序。
- `GET /api/tags/{id}/notes`

### 9.4 Media

- `POST /api/media`
- `GET /api/media/{id}`
- `DELETE /api/media/{id}`

### 9.5 Sync

- `POST /api/sync/push`
- `GET /api/sync/pull`
- `GET /api/sync/state`

### 9.6 Heatmap

- `GET /api/heatmap?range=quarter|half_year|year`

---

## 10. Web 交互设计

### 10.1 左侧区域

- 第一行显示用户名。
- 用户名可下拉，首版下拉包含“偏好设置”。
- 偏好设置以悬浮图层显示。
- 第二行显示：笔记数量、标签数量、注册天数。
- 热力图默认显示最近一个季度。
- 热力图为多行日历格，每个小格代表一天。
- 鼠标移动到热力图小格时显示：`x 条笔记于 yyyy-mm-dd`。
- 热力图后续支持最近半年、最近一年。
- 显示“全部笔记”入口。
- 显示“全部标签”区域。
- 标签支持排序、搜索、置顶。
- 标签后显示包含该标签的笔记数。
- `note_count = 0` 的标签默认隐藏。
- 点击父标签时，右侧显示该标签及所有子标签下的笔记。

### 10.2 右侧区域

- 第一行左侧显示“全部笔记”或当前筛选标签名。
- 第一行右侧是搜索框。
- 新笔记输入框默认 5 行。
- 输入超过 5 行时，输入框内部滚动。
- 输入框右上角有扩大图标。
- 点击扩大图标后打开悬浮大输入框，并转移原输入内容。
- 大输入框有提交和关闭按钮。
- 关闭大输入框时，如果有未提交内容，需要二次确认。
- 笔记列表每条笔记默认显示 5 行。
- 超出内容默认折叠，可点击展开。
- 每条笔记第一行显示创建时间。
- 每条笔记右侧显示三个点菜单。
- 三个点菜单包含编辑和删除。
- 双击笔记内容或点击编辑后进入编辑状态。
- 编辑状态变成输入框，并显示提交按钮。

---

## 11. 热力图

首版不单独维护每日统计表，通过查询聚合：

- 按 `created_at` 聚合创建数量。
- 按 `updated_at` 聚合修改数量。
- 支持 `quarter`、`half_year`、`year`。

响应包含每天的数据：

```json
{
  "range": "quarter",
  "days": [
    {
      "date": "2026-05-26",
      "createdCount": 3,
      "updatedCount": 2,
      "totalCount": 5
    }
  ]
}
```

前端展示：

- 多行日历格。
- 每格代表一天。
- 颜色深浅表示 `totalCount`。
- hover tooltip 显示：`5 条笔记于 2026-05-26`。

后续数据量增大时，可增加 `daily_note_stats` 增量统计表。

---

## 12. 安全与权限

- 所有用户数据表都有 `user_id`。
- 所有查询必须带当前 `user_id`。
- 用户 A 不能访问用户 B 的笔记、标签、媒体、session。
- JWT 包含 `user_id`、`session_id`、`device_code`、`jwt_version`。
- Refresh token 只保存 hash。
- 修改密码撤销所有 session。
- 媒体文件访问必须通过鉴权 API。
- 上传文件限制 MIME、大小和扩展名。
- 首版不验证邮箱，但保留 SMTP 配置扩展点。

---

## 13. 错误响应

统一错误格式：

```json
{
  "error": {
    "code": "note_conflict_copied",
    "message": "同步冲突已创建副本",
    "requestId": "request-id"
  }
}
```

常见错误码：

- `auth_invalid_credentials`
- `auth_session_revoked`
- `note_not_found`
- `note_version_conflict`
- `note_conflict_copied`
- `delete_conflict_ignored`
- `media_invalid_type`
- `sync_duplicate_operation`
- `validation_failed`

---

## 14. 后台任务

### 14.1 回收站过期任务

- 定期查找 `purge_after < now()` 且 `permanently_deleted_at IS NULL` 的回收站笔记。
- 设置 `permanently_deleted_at = now()`。
- 删除该笔记媒体引用。
- 将无引用媒体标记为待清理。

### 14.2 媒体清理任务

- 定期查找无引用且超过清理窗口的媒体。
- 删除本地磁盘文件。
- 设置 `purged_at = now()`。

### 14.3 Session 清理任务

- 清理过期或撤销较久的 session。
- 控制 `user_sessions` 表体积。

---

## 15. 测试策略

实现阶段必须采用 TDD：先写失败测试，确认失败原因正确，再写最小实现让测试通过。

### 15.1 后端测试

标签测试：

- 普通标签提取。
- 嵌套标签提取。
- 同一条笔记重复标签只计一次。
- 编辑笔记后标签关联重建。
- 删除进回收站后移除标签关联。
- 恢复笔记后重建标签关联。
- 标签 `note_count = 0` 时默认隐藏。

同步测试：

- `opId` 幂等。
- `client_id` 创建去重。
- update 版本冲突自动创建冲突副本。
- 冲突副本内容前插入提示和 divider。
- delete 版本冲突被忽略。
- pull 返回回收站 tombstone 和永久删除 tombstone。

权限测试：

- 用户 A 不能读取用户 B 的笔记。
- 用户 A 不能修改用户 B 的笔记。
- 用户 A 不能访问用户 B 的媒体。
- 用户 A 不能看到用户 B 的标签。

回收站测试：

- 删除后不出现在普通列表。
- 删除后出现在回收站。
- 删除后不出现在标签筛选结果。
- 30 天内可恢复。
- 超过 30 天后设置 `permanently_deleted_at`。
- 永久删除后用户不可恢复。
- 永久删除后关联媒体进入清理流程。

媒体测试：

- 图片上传成功。
- 非法 MIME 被拒绝。
- 超大文件被拒绝。
- 笔记内容块引用媒体。
- 无引用媒体被清理任务删除本地文件。

### 15.2 Web 测试

IndexedDB 和同步：

- 离线新增笔记写入 outbox。
- 离线编辑笔记写入 outbox。
- 离线删除笔记写入 outbox。
- 恢复网络后按顺序 push。
- 离线图片先存本地 blob。
- 同步时先上传媒体再提交 note。
- 冲突结果创建新笔记并显示。

UI 测试：

- 标签筛选显示父标签及子标签笔记。
- 热力图每格代表一天。
- 热力图 hover 显示 `x 条笔记于 yyyy-mm-dd`。
- 新笔记小输入框默认 5 行。
- 点击扩大图标打开大输入框。
- 大输入框关闭时未提交内容需要二次确认。
- 双击笔记进入编辑状态。
- 删除笔记进入回收站。

---

## 16. 后续扩展方向

- Android 客户端复用同步协议和 REST API。
- iOS 客户端复用同步协议和 REST API。
- SMTP 邮箱验证。
- 对象存储 S3/MinIO。
- Redis 缓存和队列。
- `change_seq` 单调同步游标。
- `tag_closure` 优化大规模标签树查询。
- `daily_note_stats` 优化热力图性能。
- 更高级的冲突可视化和手动合并。
