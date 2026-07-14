# Jifo

> 一个轻量、可自托管的图文笔记应用。

[GitHub 仓库](https://github.com/oduan/jifo) · [API 文档](docs/api.md) · [部署指南](docs/backend-deployment.md)

Jifo 面向快速记录与长期整理：在简洁的时间流中记录文字和图片，通过层级标签、搜索、热力图与回收站管理内容，并提供 Web、HTTP API 和 CLI 使用方式。

## 功能

- 图文笔记：支持文字输入、粘贴图片、图片预览和笔记编辑。
- 标签系统：自动识别 `#标签` 与 `#父标签/子标签`，支持筛选、重命名和删除。
- 搜索与时间流：按关键词或标签检索，按时间浏览笔记。
- 活跃热力图：直观看到每日记录情况。
- 回收站：软删除、恢复与定期清理。
- 用户与安全：注册登录、短期 JWT、refresh token、访问密钥和认证限流。
- 离线基础：Web 使用 IndexedDB 缓存和 outbox，同步接口支持幂等写入与增量拉取。
- 自托管：Go API、React Web 和 PostgreSQL 均可通过 Docker Compose 部署。
- CLI：通过访问密钥查询、搜索和创建笔记，适合脚本与 AI agent。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| Web | React 18、TypeScript、Vite、Dexie |
| API | Go、Chi、pgx |
| 数据库 | PostgreSQL 16 |
| 部署 | Docker、Docker Compose、Nginx |
| CLI | Go |

## Docker Compose 部署

### 1. 获取项目

```bash
git clone git@github.com:oduan/jifo.git
cd jifo
```

### 2. 准备配置

```bash
cp .env.production.example .env.production
```

Windows PowerShell：

```powershell
Copy-Item .env.production.example .env.production
```

编辑 `.env.production`，至少替换：

- `POSTGRES_PASSWORD`：数据库强密码。
- `JWT_SECRET`：不少于 32 字节的随机密钥。

生成随机密钥的示例：

```bash
openssl rand -hex 32
```

### 3. 启动

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

打开 [http://localhost:8080](http://localhost:8080)。Web 容器会将同源的 `/api` 请求转发给 API 容器，PostgreSQL 只绑定到宿主机回环地址。

查看日志：

```bash
docker compose --env-file .env.production logs -f web api
```

停止服务：

```bash
docker compose --env-file .env.production down
```

### 数据目录

Compose 使用仓库内的相对目录，不使用 Docker named volume：

- `./data/postgres`：PostgreSQL 数据。
- `./data/media`：上传的图片和其他媒体。

这些目录已加入 `.gitignore`。删除容器不会删除数据，但删除 `data` 目录会永久丢失数据。数据库和媒体目录应在同一个备份时间点保存。

### 备份

```bash
mkdir -p backups
docker compose --env-file .env.production exec -T db \
  pg_dump -U jifo -d jifo -Fc > backups/jifo.dump
```

同时复制 `data/media`。恢复操作应先在隔离环境演练。

### 更新

```bash
git pull
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs --tail=100 web api
```

API 启动时会自动执行尚未应用的数据库迁移。不要修改已经在生产环境执行过的 migration，应新增 migration 文件。

## 配置

常用环境变量见 [`.env.production.example`](.env.production.example)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | Web 对外端口 |
| `POSTGRES_PORT` | `5432` | PostgreSQL 本机回环端口 |
| `POSTGRES_USER` | `jifo` | 数据库用户 |
| `POSTGRES_DB` | `jifo` | 数据库名 |
| `POSTGRES_PASSWORD` | 必填 | 数据库密码 |
| `JWT_SECRET` | 必填 | 生产环境至少 32 字节 |
| `JIFO_SUBNET` | `172.30.0.0/24` | Compose 内部网络 |
| `ACCESS_TOKEN_TTL` | `15m` | access token 有效期 |
| `AUTH_RATE_LIMIT` | `10` | 认证接口限流次数 |
| `CLEANUP_INTERVAL` | `1h` | 回收站和媒体清理周期 |

生产环境建议在 Web 容器前配置 TLS 反向代理，并只开放 HTTP/HTTPS 入口。

## 本地开发

环境要求：

- Go 1.25.7+
- Node.js 20+
- Docker 与 Docker Compose

先准备环境文件并启动 PostgreSQL：

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production up -d db
```

启动 API：

```bash
cd backend
DATABASE_URL=postgres://jifo:<POSTGRES_PASSWORD>@localhost:5432/jifo?sslmode=disable \
JWT_SECRET=dev-secret-at-least-16 \
go run ./cmd/api
```

启动 Web：

```bash
cd web
npm ci
npm run dev
```

Vite 默认将 `/api` 代理到 `http://127.0.0.1:8080`。

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
npm run typecheck
npm run build
```

后端数据库集成测试需要设置 `TEST_DATABASE_URL`；未设置时会自动跳过。

## CLI

CLI 位于 `cli/`。先在 Web 设置中创建访问密钥：

```bash
cd cli
go run ./cmd/jifo login --token <access-key> --base-url http://localhost:8080/api
go run ./cmd/jifo status
go run ./cmd/jifo notes list --json
go run ./cmd/jifo notes list --search "关键词" --limit 20 --offset 0 --json
go run ./cmd/jifo notes create --text "今天的想法 #思考" --json
go run ./cmd/jifo tags tree --json
```

也可以通过环境变量配置：

```bash
JIFO_ACCESS_TOKEN=<access-key> \
JIFO_BASE_URL=http://localhost:8080/api \
go run ./cmd/jifo notes list --json
```

## 项目结构

```text
jifo/
├── backend/       Go API、数据库迁移与媒体存储
├── web/           React Web 应用与 Nginx 镜像
├── cli/           Go CLI
├── android/       Android 客户端代码
├── docs/          API、同步、开发与部署文档
└── docker-compose.yml
```

## 文档

- [本地开发](docs/local-development.md)
- [API 文档](docs/api.md)
- [同步协议](docs/sync.md)
- [部署指南](docs/backend-deployment.md)

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请：

1. 将变更控制在清晰、可审查的范围内。
2. 为行为变更补充测试。
3. 运行相关测试、类型检查或构建。
4. 不提交 `.env.production`、`data/`、访问密钥或其他敏感信息。

安全问题请不要公开披露，优先使用 GitHub Security Advisory 私下报告。

## License

[MIT](LICENSE) © 2026 oduan
