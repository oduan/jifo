# Jifo Flomo-like MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。本计划使用 checkbox（`- [ ]`）追踪进度。实现任何生产代码前必须先写失败测试并确认失败原因正确。

**Goal:** 构建 Jifo 首版：Go + PostgreSQL 后端、React Web、块结构图文笔记、嵌套标签、回收站、热力图、JWT 多设备用户体系、本地媒体存储和离线优先基础同步。

**Architecture:** Monorepo 内采用模块化单体后端与 React SPA。后端按 auth/users/notes/tags/media/sync/heatmap/platform 分模块，所有数据强制按 `user_id` 隔离；Web 使用 IndexedDB 维护缓存与 outbox，在线后按顺序同步。

**Tech Stack:** Go 1.22、PostgreSQL 16、pgx、chi、JWT、bcrypt、React、TypeScript、Vite、Vitest、Testing Library、Dexie、Docker Compose。

---

## 0. 执行原则

- 严格 TDD：每个行为先写测试，运行并确认失败，再实现最小代码。
- 每个任务完成后运行对应测试；每个里程碑完成后运行全量测试。
- 每个任务形成一次小提交，提交信息使用中文或英文均可，但必须包含：

```text
Co-Authored-By: Craft Agent <agents-noreply@craft.do>
```

- 当前目录不是 Git 仓库。实施第一步需要初始化 Git，并加入 `.superpowers/` 到 `.gitignore`。

---

## 1. 文件结构总览

### 创建目录

```text
backend/
  cmd/api/
  internal/auth/
  internal/users/
  internal/notes/
  internal/tags/
  internal/media/
  internal/sync/
  internal/heatmap/
  internal/platform/config/
  internal/platform/db/
  internal/platform/httpx/
  internal/platform/testutil/
  migrations/
  storage/media/
web/
  src/app/
  src/features/auth/
  src/features/notes/
  src/features/tags/
  src/features/media/
  src/features/sync/
  src/features/settings/
  src/features/heatmap/
  src/shared/api/
  src/shared/ui/
  src/storage/
android/
ios/
docs/superpowers/plans/
```

### 关键文件职责

- `backend/internal/tags/parser.go`：标签提取与路径规范化。
- `backend/internal/notes/service.go`：笔记创建、编辑、删除、恢复的事务编排。
- `backend/internal/sync/service.go`：outbox push、pull、冲突副本。
- `backend/internal/media/service.go`：媒体上传、鉴权读取、清理。
- `web/src/storage/db.ts`：IndexedDB schema。
- `web/src/features/sync/syncEngine.ts`：上传媒体、push outbox、pull 远端变更。
- `web/src/features/notes/NoteEditor.tsx`：块结构笔记输入与编辑。
- `web/src/features/heatmap/Heatmap.tsx`：多行日历格热力图。

---

## 2. Task 1：项目脚手架与基础工具

**Files:**
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `backend/go.mod`
- Create: `backend/Makefile`
- Create: `backend/internal/platform/config/config.go`
- Create: `backend/internal/platform/config/config_test.go`
- Create: `backend/internal/platform/httpx/error.go`
- Create: `backend/internal/platform/httpx/error_test.go`

- [ ] **Step 1: 初始化 Git 与忽略文件**

```bash
git init
```

创建 `.gitignore`：

```gitignore
.superpowers/
backend/storage/media/*
!backend/storage/media/.gitkeep
backend/bin/
backend/.env
web/node_modules/
web/dist/
.DS_Store
```

- [ ] **Step 2: 创建 PostgreSQL compose**

`docker-compose.yml`：

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: jifo
      POSTGRES_PASSWORD: jifo
      POSTGRES_DB: jifo
    ports:
      - "5432:5432"
    volumes:
      - jifo_pgdata:/var/lib/postgresql/data
volumes:
  jifo_pgdata:
```

- [ ] **Step 3: 创建后端 Go module**

```bash
cd backend
go mod init jifo/backend
go get github.com/go-chi/chi/v5 github.com/jackc/pgx/v5/pgxpool github.com/golang-jwt/jwt/v5 golang.org/x/crypto/bcrypt github.com/google/uuid
```

- [ ] **Step 4: 先写配置测试**

`backend/internal/platform/config/config_test.go`：

```go
package config

import "testing"

func TestLoadReadsEnvironmentWithDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable")
	t.Setenv("JWT_SECRET", "test-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DatabaseURL == "" {
		t.Fatal("DatabaseURL should be set")
	}
	if cfg.JWTSecret != "test-secret" {
		t.Fatalf("JWTSecret = %q", cfg.JWTSecret)
	}
	if cfg.MediaRoot != "storage/media" {
		t.Fatalf("MediaRoot = %q", cfg.MediaRoot)
	}
}
```

运行：

```bash
cd backend
go test ./internal/platform/config
```

Expected: FAIL，提示 `Load` 未定义。

- [ ] **Step 5: 实现最小配置加载**

`backend/internal/platform/config/config.go`：

```go
package config

import (
	"errors"
	"os"
)

type Config struct {
	DatabaseURL string
	JWTSecret   string
	MediaRoot   string
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		MediaRoot:   getenv("MEDIA_ROOT", "storage/media"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 6: 写统一错误响应测试并实现**

`backend/internal/platform/httpx/error_test.go`：

```go
package httpx

import "testing"

func TestAPIErrorShape(t *testing.T) {
	err := NewError("note_not_found", "笔记不存在", "req-1")
	if err.Error.Code != "note_not_found" || err.Error.Message != "笔记不存在" || err.Error.RequestID != "req-1" {
		t.Fatalf("unexpected error shape: %+v", err)
	}
}
```

`backend/internal/platform/httpx/error.go`：

```go
package httpx

type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

func NewError(code, message, requestID string) ErrorResponse {
	return ErrorResponse{Error: ErrorBody{Code: code, Message: message, RequestID: requestID}}
}
```

- [ ] **Step 7: 验证并提交**

```bash
cd backend
go test ./...
git add .
git commit -m "chore: initialize jifo monorepo foundation" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 3. Task 2：数据库迁移与测试工具

**Files:**
- Create: `backend/migrations/001_init.sql`
- Create: `backend/internal/platform/db/db.go`
- Create: `backend/internal/platform/testutil/db.go`
- Create: `backend/internal/platform/db/db_test.go`

- [ ] **Step 1: 写迁移文件**

`backend/migrations/001_init.sql` 创建核心表：`users`、`user_sessions`、`notes`、`media_assets`、`note_media_refs`、`tags`、`note_tags`、`sync_operations`。关键约束必须包括：

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  username text NOT NULL,
  avatar_media_id uuid,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  content jsonb NOT NULL,
  plain_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  permanently_deleted_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  conflict_of_note_id uuid,
  conflict_reason text,
  UNIQUE(user_id, client_id)
);

CREATE INDEX notes_user_updated_idx ON notes(user_id, updated_at, id);
CREATE INDEX notes_user_trash_idx ON notes(user_id, deleted_at, purge_after);
CREATE INDEX notes_user_permanent_idx ON notes(user_id, permanently_deleted_at);
```

同文件继续创建其他表及索引。

- [ ] **Step 2: 写 DB 连接测试**

`backend/internal/platform/db/db_test.go`：

```go
package db

import "testing"

func TestOpenRejectsEmptyURL(t *testing.T) {
	_, err := Open(t.Context(), "")
	if err == nil {
		t.Fatal("expected error for empty url")
	}
}
```

运行：

```bash
cd backend
go test ./internal/platform/db
```

Expected: FAIL，提示 `Open` 未定义。

- [ ] **Step 3: 实现 DB Open**

`backend/internal/platform/db/db.go`：

```go
package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, errors.New("database url is required")
	}
	return pgxpool.New(ctx, databaseURL)
}
```

- [ ] **Step 4: 创建测试数据库辅助函数**

`backend/internal/platform/testutil/db.go`：

```go
package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func OpenTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
```

- [ ] **Step 5: 验证并提交**

```bash
cd backend
go test ./...
git add backend/migrations backend/internal/platform/db backend/internal/platform/testutil
git commit -m "chore: add database schema foundation" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 4. Task 3：标签解析与标签树核心逻辑

**Files:**
- Create: `backend/internal/tags/parser.go`
- Create: `backend/internal/tags/parser_test.go`
- Create: `backend/internal/tags/repository.go`
- Create: `backend/internal/tags/service.go`
- Create: `backend/internal/tags/service_test.go`

- [ ] **Step 1: 写标签解析失败测试**

`backend/internal/tags/parser_test.go`：

```go
package tags

import (
	"reflect"
	"testing"
)

func TestExtractTagPathsSupportsNestedAndDedup(t *testing.T) {
	got := ExtractTagPaths("#思考 #电视剧/电视剧1 这个电视剧真的很好看 #思考")
	want := []string{"思考", "电视剧", "电视剧/电视剧1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}

func TestExtractTagPathsStopsAtWhitespace(t *testing.T) {
	got := ExtractTagPaths("hello #工作/项目A 今天继续")
	want := []string{"工作", "工作/项目A"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}
```

运行：

```bash
cd backend
go test ./internal/tags
```

Expected: FAIL，提示 `ExtractTagPaths` 未定义。

- [ ] **Step 2: 实现标签解析**

`backend/internal/tags/parser.go`：

```go
package tags

import (
	"sort"
	"strings"
	"unicode"
)

func ExtractTagPaths(text string) []string {
	seen := map[string]bool{}
	for i, r := range text {
		if r != '#' {
			continue
		}
		part := readTag(text[i+len(string(r)):])
		if part == "" {
			continue
		}
		segments := strings.Split(part, "/")
		path := ""
		for _, segment := range segments {
			segment = strings.TrimSpace(segment)
			if segment == "" {
				continue
			}
			if path == "" {
				path = segment
			} else {
				path += "/" + segment
			}
			seen[path] = true
		}
	}
	out := make([]string, 0, len(seen))
	for path := range seen {
		out = append(out, path)
	}
	sort.Slice(out, func(i, j int) bool {
		if strings.Count(out[i], "/") == strings.Count(out[j], "/") {
			return out[i] < out[j]
		}
		return strings.Count(out[i], "/") < strings.Count(out[j], "/")
	})
	return out
}

func readTag(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsSpace(r) || strings.ContainsRune("，。！？,.!?;；:：()（）[]【】{}", r) {
			break
		}
		b.WriteRune(r)
	}
	return strings.Trim(b.String(), "/")
}
```

- [ ] **Step 3: 写标签 upsert 集成测试**

`backend/internal/tags/service_test.go`：

```go
package tags

import "testing"

func TestEnsurePathsCreatesParentsAndChildOnce(t *testing.T) {
	// 使用 testutil.OpenTestDB；插入用户；调用 EnsurePaths 两次。
	// 断言 tags 表中只有 “电视剧” 和 “电视剧/电视剧1” 两行。
}
```

运行：

```bash
TEST_DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable go test ./internal/tags
```

Expected: FAIL，提示 `EnsurePaths` 未定义或断言失败。

- [ ] **Step 4: 实现 `EnsurePaths`**

实现要求：

- 使用事务。
- 对每个 path 先确保父级存在。
- 使用 `INSERT ... ON CONFLICT (user_id, path) DO UPDATE SET updated_at = now() RETURNING id`。
- 返回 path 到 tag id 的映射。

- [ ] **Step 5: 验证并提交**

```bash
cd backend
go test ./internal/tags
git add backend/internal/tags
git commit -m "feat: add nested tag parsing and upsert" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 5. Task 4：用户注册、登录、多设备 session 与密码修改

**Files:**
- Create: `backend/internal/auth/service.go`
- Create: `backend/internal/auth/service_test.go`
- Create: `backend/internal/auth/tokens.go`
- Create: `backend/internal/auth/tokens_test.go`
- Create: `backend/internal/users/service.go`
- Create: `backend/internal/users/service_test.go`

- [ ] **Step 1: 写密码 hash 测试**

测试 `HashPassword` 与 `VerifyPassword`：正确密码通过，错误密码失败。

- [ ] **Step 2: 实现 bcrypt hash**

使用 `bcrypt.GenerateFromPassword` 和 `bcrypt.CompareHashAndPassword`。

- [ ] **Step 3: 写 JWT claims 测试**

Claims 必须包含：`user_id`、`session_id`、`device_code`、`jwt_version`。

- [ ] **Step 4: 实现 JWT 生成与解析**

使用 `github.com/golang-jwt/jwt/v5`。

- [ ] **Step 5: 写注册登录集成测试**

行为：

- 注册创建用户。
- 同 email 再注册失败。
- 登录成功创建 `user_sessions`。
- 不同 `device_code` 登录产生不同 session。

- [ ] **Step 6: 实现注册登录服务**

要求：

- email 统一转小写并 trim。
- username 默认取 email 前缀。
- refresh token 只保存 hash。
- 返回 access token、refresh token、用户资料。

- [ ] **Step 7: 写修改密码测试**

行为：

- 修改密码后 `users.password_hash` 更新。
- 该用户所有 `user_sessions.revoked_at` 被设置。
- 旧 refresh token 不能刷新。

- [ ] **Step 8: 实现修改密码服务**

在事务中更新密码并撤销 session。

- [ ] **Step 9: 验证并提交**

```bash
cd backend
go test ./internal/auth ./internal/users
git add backend/internal/auth backend/internal/users
git commit -m "feat: add auth users and multi-device sessions" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 6. Task 5：笔记服务、标签事务、回收站与恢复

**Files:**
- Create: `backend/internal/notes/model.go`
- Create: `backend/internal/notes/service.go`
- Create: `backend/internal/notes/service_test.go`
- Modify: `backend/internal/tags/service.go`

- [ ] **Step 1: 写创建笔记测试**

行为：

- 创建 note 保存 `content` 和 `plain_text`。
- 自动提取 `#思考 #电视剧/电视剧1`。
- 创建 tags 与 note_tags。
- `note_count` 正确。

- [ ] **Step 2: 实现创建笔记**

事务顺序：insert note → 提取标签 → EnsurePaths → insert note_tags → RecountTags。

- [ ] **Step 3: 写编辑笔记重建标签测试**

行为：

- 原笔记含 `#A`。
- 编辑后变成 `#B/子`。
- `#A` 的 `note_count` 变 0。
- `#B` 和 `#B/子` 的 `note_count` 为 1。

- [ ] **Step 4: 实现编辑笔记**

事务中更新 note、删除旧 note_tags、重建新 note_tags、更新 version。

- [ ] **Step 5: 写删除进回收站测试**

行为：

- 删除设置 `deleted_at` 和 `purge_after`。
- 删除 note_tags。
- 标签计数减少。
- 普通列表不返回。
- 回收站列表返回。

- [ ] **Step 6: 实现删除进回收站**

`purge_after = now() + 30 days`，并更新 `version`。

- [ ] **Step 7: 写恢复测试**

行为：

- 恢复清空 `deleted_at`、`purge_after`。
- 重新解析标签并创建 note_tags。
- 标签重新显示。

- [ ] **Step 8: 实现恢复**

恢复时按当前解析规则重建标签。

- [ ] **Step 9: 验证并提交**

```bash
cd backend
go test ./internal/notes ./internal/tags
git add backend/internal/notes backend/internal/tags
git commit -m "feat: add notes lifecycle and tag transactions" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 7. Task 6：媒体上传、本地存储与清理

**Files:**
- Create: `backend/internal/media/service.go`
- Create: `backend/internal/media/service_test.go`
- Create: `backend/storage/media/.gitkeep`
- Modify: `backend/internal/notes/service.go`

- [ ] **Step 1: 写 MIME 限制测试**

允许：`image/jpeg`、`image/png`、`image/webp`、`image/gif`。拒绝：`text/html`、未知 MIME。

- [ ] **Step 2: 实现媒体校验**

限制 MIME 与大小，首版默认最大 10MB。

- [ ] **Step 3: 写上传保存测试**

行为：上传后创建 `media_assets`，文件保存到 `storage/media/{user_id}/{media_id}`。

- [ ] **Step 4: 实现上传保存**

使用临时文件写入后 rename，避免半文件。

- [ ] **Step 5: 写笔记永久删除后媒体清理测试**

行为：

- 笔记超过 30 天后标记 `permanently_deleted_at`。
- 删除 `note_media_refs`。
- 无引用媒体设置 `deleted_at` 与 `purge_after`。
- 媒体清理任务删除本地文件并设置 `purged_at`。

- [ ] **Step 6: 实现媒体清理服务**

提供两个方法：

- `MarkUnreferencedAssetsForDeletion(ctx, tx, userID)`
- `PurgeDueAssets(ctx, now)`

- [ ] **Step 7: 验证并提交**

```bash
cd backend
go test ./internal/media ./internal/notes
git add backend/internal/media backend/storage/media/.gitkeep backend/internal/notes
git commit -m "feat: add local media storage and cleanup" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 8. Task 7：同步 push/pull 与冲突副本

**Files:**
- Create: `backend/internal/sync/service.go`
- Create: `backend/internal/sync/service_test.go`
- Modify: `backend/internal/notes/service.go`

- [ ] **Step 1: 写 opId 幂等测试**

同一个 `opId` push 两次，只创建一次笔记，第二次返回第一次的 result。

- [ ] **Step 2: 实现 sync_operations 幂等记录**

事务开始时检查 `(user_id, op_id)`；成功后写入 result JSON。

- [ ] **Step 3: 写 client_id 创建去重测试**

相同 `client_id` 重试 create，不创建重复 notes。

- [ ] **Step 4: 实现 create 去重**

依赖 `notes(user_id, client_id)` 唯一约束。

- [ ] **Step 5: 写 update 冲突副本测试**

场景：

- 服务器 note version = 2。
- 客户端以 baseVersion = 1 提交 update。
- 原 note 不变。
- 新建一条 note。
- 新 note `conflict_of_note_id` 指向原 note。
- 新 note 内容前两块是提示 paragraph 与 divider。

- [ ] **Step 6: 实现冲突副本**

冲突提示文本固定为：

```text
这是一条冲突副本，原笔记已在其他设备被更新。
```

生成 blocks：提示 paragraph → divider → 客户端原 blocks。

- [ ] **Step 7: 写 delete 冲突忽略测试**

落后的 delete 不删除原 note，返回 `delete_conflict_ignored`。

- [ ] **Step 8: 实现 delete 冲突忽略**

返回状态，不创建副本，不修改原 note。

- [ ] **Step 9: 写 pull tombstone 测试**

pull 返回：普通变更、回收站 tombstone、永久删除 tombstone。

- [ ] **Step 10: 实现 pull**

首版 cursor 使用 `(updated_at, id)`。

- [ ] **Step 11: 验证并提交**

```bash
cd backend
go test ./internal/sync ./internal/notes
git add backend/internal/sync backend/internal/notes
git commit -m "feat: add offline sync and conflict copies" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 9. Task 8：Heatmap、列表、搜索与 API 路由

**Files:**
- Create: `backend/internal/heatmap/service.go`
- Create: `backend/internal/heatmap/service_test.go`
- Create: `backend/cmd/api/main.go`
- Create: `backend/internal/platform/httpx/middleware.go`
- Create: `backend/internal/notes/handler.go`
- Create: `backend/internal/tags/handler.go`
- Create: `backend/internal/auth/handler.go`
- Create: `backend/internal/media/handler.go`
- Create: `backend/internal/sync/handler.go`
- Create: `backend/internal/heatmap/handler.go`

- [ ] **Step 1: 写 heatmap 聚合测试**

行为：给定多条 created/updated 日期不同的 note，返回每天 createdCount、updatedCount、totalCount。

- [ ] **Step 2: 实现 heatmap 查询**

按用户和范围过滤，排除永久删除笔记。

- [ ] **Step 3: 写标签筛选列表测试**

选择父标签 `电视剧`，返回包含 `电视剧` 与 `电视剧/电视剧1` 的笔记。

- [ ] **Step 4: 实现 notes list 查询**

支持：分页、搜索、tag path、trash 参数。

- [ ] **Step 5: 写 HTTP handler 冒烟测试**

至少覆盖：register、login、create note、list notes、tags tree、heatmap。

- [ ] **Step 6: 实现 API 路由**

使用 chi，所有 `/api/*` 返回 JSON 错误结构。

- [ ] **Step 7: 验证并提交**

```bash
cd backend
go test ./...
git add backend/cmd backend/internal
git commit -m "feat: expose backend api routes" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 10. Task 9：Web 脚手架、API Client 与认证界面

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/src/app/App.tsx`
- Create: `web/src/shared/api/client.ts`
- Create: `web/src/features/auth/LoginPage.tsx`
- Create: `web/src/features/auth/authStore.ts`
- Create: `web/src/features/auth/LoginPage.test.tsx`

- [ ] **Step 1: 创建 Vite React TS 项目**

```bash
cd web
npm create vite@latest . -- --template react-ts
npm install dexie @tanstack/react-query
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

- [ ] **Step 2: 写 API client 测试**

测试：自动加 Authorization header；401 时可触发 refresh 流程。

- [ ] **Step 3: 实现 API client**

`web/src/shared/api/client.ts` 封装 `request<T>()`。

- [ ] **Step 4: 写登录页面测试**

行为：输入 email、password、deviceName 后提交，成功后显示主界面。

- [ ] **Step 5: 实现登录/注册页面**

保持简单样式，后续主布局统一美化。

- [ ] **Step 6: 验证并提交**

```bash
cd web
npm test -- --run
npm run build
git add web
git commit -m "feat: add web scaffold and auth screens" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 11. Task 10：Web 主布局、标签、热力图与笔记流

**Files:**
- Create: `web/src/features/notes/NotesPage.tsx`
- Create: `web/src/features/notes/NoteCard.tsx`
- Create: `web/src/features/notes/NoteEditor.tsx`
- Create: `web/src/features/tags/TagTree.tsx`
- Create: `web/src/features/heatmap/Heatmap.tsx`
- Create: `web/src/features/settings/SettingsPopover.tsx`
- Create: `web/src/features/heatmap/Heatmap.test.tsx`
- Create: `web/src/features/notes/NoteEditor.test.tsx`

- [ ] **Step 1: 写热力图测试**

行为：

- 渲染多行日历格。
- 每格代表一天。
- hover 显示 `x 条笔记于 yyyy-mm-dd`。

- [ ] **Step 2: 实现 Heatmap**

使用 CSS grid，按 range 生成日期格。

- [ ] **Step 3: 写 NoteEditor 测试**

行为：

- 默认 5 行。
- 点击扩大图标打开大输入浮层。
- 大输入浮层关闭时如有未提交内容弹二次确认。
- 支持提交 paragraph blocks。

- [ ] **Step 4: 实现 NoteEditor**

首版先支持 paragraph 与 image block 插入。

- [ ] **Step 5: 写 NoteCard 测试**

行为：默认折叠 5 行；点击展开显示全部；双击进入编辑状态；三点菜单可删除。

- [ ] **Step 6: 实现 NoteCard**

编辑提交后调用 notes API 或离线 outbox。

- [ ] **Step 7: 写 TagTree 测试**

行为：隐藏 note_count = 0 标签；点击父标签触发筛选；显示 note_count。

- [ ] **Step 8: 实现主布局**

左侧：用户名、统计、热力图、全部笔记、全部标签。右侧：标题、搜索、新笔记、笔记流。

- [ ] **Step 9: 验证并提交**

```bash
cd web
npm test -- --run
npm run build
git add web/src
git commit -m "feat: add flomo-like web notes layout" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 12. Task 11：Web IndexedDB 离线 outbox 与同步引擎

**Files:**
- Create: `web/src/storage/db.ts`
- Create: `web/src/features/sync/outbox.ts`
- Create: `web/src/features/sync/syncEngine.ts`
- Create: `web/src/features/sync/syncEngine.test.ts`
- Modify: `web/src/features/notes/NoteEditor.tsx`
- Modify: `web/src/features/notes/NoteCard.tsx`

- [ ] **Step 1: 写 IndexedDB schema 测试**

行为：能写入 `notes_cache`、`media_cache`、`outbox`、`sync_state`。

- [ ] **Step 2: 实现 Dexie DB**

定义表：

```ts
notes_cache: 'id, clientId, updatedAt, deletedAt, permanentlyDeletedAt'
media_cache: 'id, localId, serverId, status'
outbox: '++localSeq, opId, entity, action, createdAt, status'
sync_state: 'key'
```

- [ ] **Step 3: 写离线新增测试**

离线新增 note 时：立即更新本地 cache，并写入 outbox create。

- [ ] **Step 4: 实现 outbox create/update/delete/restore**

保证每个操作有 `opId`、`clientId`、`baseVersion`。

- [ ] **Step 5: 写媒体优先上传测试**

如果 note blocks 引用本地 blob，同步时先调用 media upload，再替换为 server `mediaId`，最后 push note。

- [ ] **Step 6: 实现 syncEngine**

顺序：上传媒体 → push outbox → pull 远端变更 → 更新本地 cache。

- [ ] **Step 7: 写冲突副本展示测试**

后端返回 `conflict_copied` 后，本地 cache 增加 conflict note。

- [ ] **Step 8: 实现冲突结果处理**

把 conflict note 当普通 note 写入缓存，显示在笔记流。

- [ ] **Step 9: 验证并提交**

```bash
cd web
npm test -- --run
npm run build
git add web/src
git commit -m "feat: add offline outbox sync engine" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 13. Task 12：端到端验收、文档与收尾

**Files:**
- Create: `README.md`
- Create: `docs/api.md`
- Create: `docs/sync.md`
- Create: `docs/local-development.md`

- [ ] **Step 1: 写本地开发文档**

必须包含：

```bash
docker compose up -d db
cd backend && DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable JWT_SECRET=dev-secret go run ./cmd/api
cd web && npm install && npm run dev
```

- [ ] **Step 2: 写 API 文档**

列出 auth、notes、tags、media、sync、heatmap endpoints，包含请求/响应示例。

- [ ] **Step 3: 写同步协议文档**

包含 outbox 格式、push、pull、冲突副本、delete 冲突忽略、媒体先上传规则。

- [ ] **Step 4: 全量验证**

```bash
cd backend
go test ./...
cd ../web
npm test -- --run
npm run build
```

Expected: 全部通过，无明显 warning。

- [ ] **Step 5: 手动验收路径**

1. 注册用户 A。
2. 创建 `#思考 #电视剧/电视剧1` 图文笔记。
3. 左侧标签出现 `思考`、`电视剧`、`电视剧1`。
4. 点击 `电视剧`，右侧显示包含子标签的笔记。
5. 热力图当天格子计数增加，hover 显示 `x 条笔记于 yyyy-mm-dd`。
6. 删除笔记后进入回收站，标签计数减少。
7. 30 天过期任务执行后，笔记不可恢复，媒体进入清理。
8. 模拟两个设备编辑冲突，后提交内容创建冲突副本，前面包含提示与 `----`。

- [ ] **Step 6: 最终提交**

```bash
git add README.md docs backend web
git commit -m "docs: add jifo development and api documentation" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## 14. 计划自查

- 设计覆盖：用户体系、笔记、图片媒体、嵌套标签、回收站、30 天永久删除标记、媒体同步清理、热力图、离线同步、冲突副本、Web 左右布局均已覆盖。
- 并发与性能：依赖数据库唯一约束、事务、局部重算 `note_count`、`opId` 幂等和 `client_id` 去重。
- 扩展性：保留 Android/iOS 目录、SMTP 字段、对象存储迁移空间、`change_seq` 与 `tag_closure` 后续演进空间。
- 测试策略：每个行为先写测试，后实现，后验证。
