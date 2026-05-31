# Jifo 本地开发指南

## 环境要求

- Go 1.22+
- Node.js 20+ / npm
- Docker 与 Docker Compose
- PostgreSQL 16（可通过 docker compose 启动）

## 启动数据库

```bash
docker compose up -d db
```

默认数据库配置：

- 用户：`jifo`
- 密码：`jifo`
- 数据库：`jifo`
- 端口：`5432`

## 启动后端 API

```bash
cd backend
DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable JWT_SECRET=dev-secret-at-least-16 go run ./cmd/api
```

后端启动后会自动按文件名顺序执行 `backend/migrations/*.sql` 中尚未记录的迁移，并记录到 `schema_migrations`。

- 全新数据库：直接启动 backend，会自动执行 `001_init.sql`、`002_access_keys.sql` 等全部迁移。
- 存量旧数据库：迁移执行器不做旧结构认领。如果旧环境已经手动执行过旧 migration，需要先人工补 `schema_migrations` 记录。

旧环境已执行过 `001_init.sql` 时，可先执行：

```powershell
@"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT (version) DO NOTHING;
"@ | docker compose exec -T db psql -U jifo -d jifo
```

如果旧环境也已经执行过 `002_access_keys.sql`，再补：

```powershell
"INSERT INTO schema_migrations (version) VALUES ('002_access_keys') ON CONFLICT (version) DO NOTHING;" | docker compose exec -T db psql -U jifo -d jifo
```

可选环境变量：

- `ADDR`：HTTP 监听地址，默认 `:8080`
- `MEDIA_ROOT`：本地媒体根目录，默认 `storage/media`
- `JIFO_MIGRATIONS_DIR`：迁移 SQL 目录，默认自动查找 `backend/migrations`

## 启动 Web

```bash
cd web
npm install
npm run dev
```

## 测试与构建

后端：

```bash
cd backend
go test ./...
```

Web：

```bash
cd web
npm test -- --run
npm run build
```

## 数据库测试

后端部分集成测试依赖真实 PostgreSQL。设置 `TEST_DATABASE_URL` 后会运行迁移和集成测试：

```bash
cd backend
TEST_DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable go test ./...
```

未设置时，相关集成测试会自动 skip。

## 常见问题

### Web 测试为什么有 fake-indexeddb？

Web 同步模块使用 Dexie/IndexedDB。Vitest + jsdom 默认没有真实 IndexedDB，因此测试环境在 `web/src/test/setup.ts` 引入 `fake-indexeddb/auto`。生产入口不会导入它。

### `/api/sync/push` 为什么返回 501？

当前 MVP 已实现后端同步 service 与 Web sync engine，但 HTTP handler 仍是占位；完整 HTTP 接入可在下一迭代完成。
