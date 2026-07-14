# Jifo

Jifo 是一个类似 Flomo 的笔记 MVP：Go + PostgreSQL 后端、React Web、块结构图文笔记、嵌套标签、回收站、热力图、JWT 多设备用户体系、本地媒体基础能力，以及 Web 侧离线优先 outbox/sync 基础。

## 当前范围

已完成首版核心骨架：

- 后端：用户注册/登录、JWT access token 校验、多设备 session 基础、笔记创建/列表、标签解析与树、热力图、媒体/同步基础模块。
- Web：Vite + React + TypeScript、认证界面、Flomo-like 双栏笔记布局、笔记编辑器、标签树、热力图、IndexedDB cache/outbox、离线同步引擎基础。
- 存储：PostgreSQL；Web 本地缓存使用 Dexie/IndexedDB。

> 注意：HTTP 层已接入 notes/tags/heatmap、`/api/sync/push`、`/api/sync/pull` 以及 `/api/media` 上传/读取；Web App 已接真实 API、自动同步、离线文字笔记回退、回收站、图片上传和账户设置。离线媒体创建与更细的同步状态提示仍可继续补全。

## 快速开始

```bash
docker compose up -d db

cd backend
DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable JWT_SECRET=dev-secret-at-least-16 go run ./cmd/api

cd ../web
npm install
npm run dev
```

默认后端监听 `:8080`；Web dev server 由 Vite 输出本地地址。

## CLI

Jifo 也包含一个独立 Go CLI，位于 `cli/`。

```bash
cd cli
go test ./...
go run ./cmd/jifo --help
```

使用 Web 设置中创建的访问密钥配置 CLI：

```bash
go run ./cmd/jifo login --token <access-key> --base-url http://localhost:8080/api
go run ./cmd/jifo status
```

环境变量可以覆盖已保存配置，适合脚本和 AI agent：

```bash
JIFO_ACCESS_TOKEN=<access-key> JIFO_BASE_URL=http://localhost:8080/api go run ./cmd/jifo notes list --json
```

常用命令：

```bash
go run ./cmd/jifo notes list --search "关键词" --limit 20 --offset 0 --json
go run ./cmd/jifo notes list --tag "思考" --json
go run ./cmd/jifo notes create --text "今天的想法 #思考" --json
go run ./cmd/jifo tags list --json
go run ./cmd/jifo tags tree --json
```

后端启动时会自动执行 `backend/migrations/*.sql` 中尚未记录的数据库迁移，并写入 `schema_migrations`。全新数据库只需启动 backend，会按顺序执行 `001_init.sql`、`002_access_keys.sql` 等迁移。

> 存量旧数据库注意：迁移执行器不做旧结构“认领”。如果旧环境已经人工执行过 `001_init.sql`，升级前需要手动创建 `schema_migrations` 并插入已执行版本；否则新版后端会尝试重新执行 `001_init.sql` 并因表已存在而失败。

## 测试

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

后端集成测试如需真实数据库，请设置 `TEST_DATABASE_URL`；未设置时相关测试会跳过。

## 文档

- [本地开发](docs/local-development.md)
- [API 文档](docs/api.md)
- [同步协议](docs/sync.md)
- [后端部署](docs/backend-deployment.md)
- [设计文档](docs/superpowers/specs/2026-05-26-jifo-flomo-like-mvp-design.md)
- [实施计划](docs/superpowers/plans/2026-05-26-jifo-flomo-like-mvp-implementation-plan.md)
