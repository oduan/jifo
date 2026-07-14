# Jifo 本地开发指南

## 环境要求

- Go 1.25.7+
- Node.js 20+ / npm
- Docker 与 Docker Compose
- PostgreSQL 16（仅在宿主机直接运行 Go API 时需要）

## 使用 Compose 运行完整环境

```bash
cp .env.example .env
docker compose up -d --build
```

访问 `http://localhost:8086`。生产拓扑默认只发布 Web/Nginx 端口；API 和 PostgreSQL 仅在 Docker 内部网络中通过 `api`、`db` 服务名访问。

数据库数据保存在仓库相对目录 `data/postgres`，媒体保存在 `data/media`，两个目录均被 Git 忽略。

## 在宿主机运行源码

如需直接运行 Go API，请先在宿主机准备一个仅监听本机的 PostgreSQL 16，并创建 `jifo` 数据库。Compose 中的数据库不会发布宿主机端口，这是有意的生产安全边界。

## 启动后端 API

```bash
cd backend
DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable JWT_SECRET=dev-secret-at-least-16 go run ./cmd/api
```

示例中的用户名和密码仅供本机开发，请按实际 PostgreSQL 配置替换。

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

- `APP_ENV`：运行环境，默认 `development`；生产环境会执行更严格的配置校验
- `ADDR`：HTTP 监听地址，默认 `:8080`
- `MEDIA_ROOT`：本地媒体根目录，默认 `storage/media`
- `JIFO_MIGRATIONS_DIR`：迁移 SQL 目录，默认自动查找 `backend/migrations`
- `TRUSTED_PROXIES`：以逗号分隔的可信代理 IP 或 CIDR
- `HTTP_READ_HEADER_TIMEOUT`、`HTTP_READ_TIMEOUT`、`HTTP_WRITE_TIMEOUT`、`HTTP_IDLE_TIMEOUT`
- `SHUTDOWN_TIMEOUT`：优雅停机时限，默认 `15s`
- `AUTH_RATE_LIMIT`、`AUTH_RATE_WINDOW`：认证端点单 IP 限流
- `ACCESS_TOKEN_TTL`：JWT access token 有效期，默认 `15m`
- `CLEANUP_INTERVAL`、`CLEANUP_TIMEOUT`：回收站和无引用媒体清理任务配置

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

### `/api/sync/push` 和 `/api/sync/pull` 是否可用？

可用。当前后端已经接入同步 HTTP handler，支持幂等 push、版本冲突处理和基于 cursor 的增量 pull。
