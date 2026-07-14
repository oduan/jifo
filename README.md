# Jifo

> 一个轻量、可自托管的图文笔记应用。

[GitHub 仓库](https://github.com/oduan/jifo) · [API 文档](docs/api.md) · [MCP 接入](docs/mcp.md) · [部署指南](docs/backend-deployment.md)

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
- MCP：提供带 Bearer 鉴权的 Streamable HTTP 端点，让 Codex 等 agent 搜索和修改笔记、标签。

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
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，替换其中两个必填值：

- `POSTGRES_PASSWORD`：数据库强密码。
- `JWT_SECRET`：不少于 32 字节的随机密钥。

生成随机密钥的示例：

```bash
openssl rand -hex 32
```

### 3. 启动

```bash
docker compose up -d --build
docker compose ps
```

打开 [http://localhost:8086](http://localhost:8086)。只有 Web/Nginx 的 `8086` 端口绑定到宿主机回环地址；API 和 PostgreSQL 不发布宿主机端口，只能通过 Compose 内部网络和服务名访问。

查看日志：

```bash
docker compose logs -f web api
```

停止服务：

```bash
docker compose down
```

### 数据目录

Compose 使用仓库内的相对目录，不使用 Docker named volume：

- `./data/postgres`：PostgreSQL 数据。
- `./data/media`：上传的图片和其他媒体。

这些目录已加入 `.gitignore`。删除容器不会删除数据，但删除 `data` 目录会永久丢失数据。数据库和媒体目录应在同一个备份时间点保存。

### 备份

```bash
mkdir -p backups
docker compose exec -T db \
  pg_dump -U jifo -d jifo -Fc > backups/jifo.dump
```

同时复制 `data/media`。恢复操作应先在隔离环境演练。

### 更新

```bash
git pull
docker compose up -d --build
docker compose logs --tail=100 web api
```

API 启动时会自动执行尚未应用的数据库迁移。不要修改已经在生产环境执行过的 migration，应新增 migration 文件。

## 配置

复制 [`.env.example`](.env.example) 为 `.env` 即可启动。模板只保留两个必填密钥；其余变量都有 Compose 默认值，仅在需要覆盖时添加到 `.env`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `8086` | Web 宿主机回环端口 |
| `POSTGRES_USER` | `jifo` | 数据库用户 |
| `POSTGRES_DB` | `jifo` | 数据库名 |
| `POSTGRES_PASSWORD` | 必填 | 数据库密码 |
| `JWT_SECRET` | 必填 | 生产环境至少 32 字节 |
| `TRUSTED_PROXIES` | RFC1918 私网段 | API 信任的内部反向代理 CIDR；自定义 Docker 地址池时覆盖 |
| `ACCESS_TOKEN_TTL` | `15m` | access token 有效期 |
| `AUTH_RATE_LIMIT` | `10` | 认证接口限流次数 |
| `CLEANUP_INTERVAL` | `1h` | 回收站和媒体清理周期 |

生产环境建议在 Web 容器前配置 TLS 反向代理，并只开放 HTTP/HTTPS 入口。

### 使用 Caddy 配置 HTTPS

仓库根目录提供了 [Caddyfile](Caddyfile)，默认将 `http://localhost` 代理到 Docker Web 入口 `127.0.0.1:8086`。

生产环境设置域名后，Caddy 会自动申请和续期 HTTPS 证书：

```bash
export JIFO_SITE_ADDRESS=notes.example.com
export JIFO_UPSTREAM=127.0.0.1:8086
caddy run --config ./Caddyfile
```

- `JIFO_SITE_ADDRESS`：对外访问地址；域名会启用自动 HTTPS，默认 `http://localhost`。
- `JIFO_UPSTREAM`：Jifo Web 的上游地址，默认 `127.0.0.1:8086`。

Docker Web 端口只监听 `127.0.0.1`，公网仅需向 Caddy 开放 `80` 和 `443`。

Caddy 会将包括 `/mcp` 在内的所有路径统一转发到 Web 容器；Web 容器的 Nginx 再把 `/mcp` 转发到 API。因此使用仓库提供的 Caddyfile 时不需要额外添加 MCP 路由。生产环境的 MCP 地址为 `https://<你的域名>/mcp`。

## AI Agent / MCP 接入

Jifo 提供带 Bearer 鉴权的 Streamable HTTP MCP 服务，Codex 等 Agent 可通过它读取和修改当前用户的笔记与标签。完整工具说明见 [MCP 文档](docs/mcp.md)。

### 给 Agent 的安装约定

当 Agent 帮助用户安装 Jifo MCP 时，应遵循以下步骤：

1. 确认 Jifo 服务已启动，并选择正确的 MCP URL：本机为 `http://127.0.0.1:8086/mcp`，生产环境为 `https://<域名>/mcp`。不要使用 `/api/mcp`。
2. 让用户在 Jifo Web 的设置页面创建专用访问密钥。不要要求用户提交密钥到仓库，也不要把密钥直接写进 Codex 配置文件。
3. 将密钥保存到宿主机的 `JIFO_MCP_TOKEN` 环境变量或等价的安全凭据存储中。
4. 把 MCP 传输类型配置为 Streamable HTTP，并通过 `Authorization: Bearer <token>` 鉴权。
5. 重启或重新加载 Agent 宿主，使新环境变量和 MCP 配置生效，然后执行只读工具调用验证连接。

访问密钥代表对应用户的完整笔记访问权限。建议每个 Agent 使用独立密钥，以便在 Jifo 设置中单独撤销。

### Codex 自动配置

先设置用户级环境变量。Windows PowerShell：

```powershell
setx JIFO_MCP_TOKEN "jifo_..."
```

Linux/macOS 可将密钥注入启动 Codex 的安全环境；例如仅对当前 shell：

```bash
export JIFO_MCP_TOKEN='jifo_...'
```

注册本机 MCP 服务：

```bash
codex mcp add jifo \
  --url http://127.0.0.1:8086/mcp \
  --bearer-token-env-var JIFO_MCP_TOKEN
```

生产部署时将 URL 替换为 `https://<域名>/mcp`。也可以直接写入 `~/.codex/config.toml`：

```toml
[mcp_servers.jifo]
url = "http://127.0.0.1:8086/mcp"
bearer_token_env_var = "JIFO_MCP_TOKEN"
default_tools_approval_mode = "writes"
```

检查配置：

```bash
codex mcp get jifo --json
codex mcp list
```

完全退出并重新启动 Codex 后，可用以下任务验证：

```text
使用 Jifo 列出标签树。
使用 Jifo 搜索最近一个月包含“项目”的笔记。
使用 Jifo 创建一条“Agent MCP 连接成功 #测试”笔记。
```

对于其他 MCP 客户端，配置等价信息即可：传输类型为 `streamable-http`、URL 为 Jifo `/mcp` 端点，并在每个请求中发送 Bearer 访问密钥。本机地址只能供本机 Agent 使用；云端 Agent 必须连接可访问且启用 HTTPS 的部署地址。

## 本地开发

环境要求：

- Go 1.25.7+
- Node.js 20+
- Docker 与 Docker Compose

最简单的本地运行方式是启动完整 Compose 栈：

```bash
cp .env.example .env
docker compose up -d --build
```

如果需要直接运行 Go API 进行源码开发，请另行准备只监听本机的 PostgreSQL 16；生产 Compose 中的数据库不会发布到宿主机。然后启动 API：

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

Vite 默认将 `/api` 和 `/mcp` 代理到 `http://127.0.0.1:8080`。

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
go run ./cmd/jifo login --token <access-key> --base-url http://localhost:8086/api
go run ./cmd/jifo status
go run ./cmd/jifo notes list --json
go run ./cmd/jifo notes list --search "关键词" --limit 20 --offset 0 --json
go run ./cmd/jifo notes create --text "今天的想法 #思考" --json
go run ./cmd/jifo tags tree --json
```

也可以通过环境变量配置：

```bash
JIFO_ACCESS_TOKEN=<access-key> \
JIFO_BASE_URL=http://localhost:8086/api \
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
├── Caddyfile      可选的 HTTPS 反向代理配置
└── docker-compose.yml
```

## 文档

- [本地开发](docs/local-development.md)
- [API 文档](docs/api.md)
- [MCP 接入](docs/mcp.md)
- [同步协议](docs/sync.md)
- [部署指南](docs/backend-deployment.md)

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请：

1. 将变更控制在清晰、可审查的范围内。
2. 为行为变更补充测试。
3. 运行相关测试、类型检查或构建。
4. 不提交 `.env`、`data/`、访问密钥或其他敏感信息。

安全问题请不要公开披露，优先使用 GitHub Security Advisory 私下报告。

## License

[MIT](LICENSE) © 2026 oduan
