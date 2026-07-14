# Docker 部署指南

本文档说明如何使用 Docker Compose 部署 Jifo Web、API 与 PostgreSQL。默认拓扑为：

```text
Browser → Web (Nginx) → API (Go) → PostgreSQL
                         └→ data/media
```

## 准备配置

```bash
cp .env.example .env
```

`.env` 只需要配置 `POSTGRES_PASSWORD` 和 `JWT_SECRET`。生产环境的 `JWT_SECRET` 至少 32 字节；其他设置都有默认值，需要时再添加到 `.env`。

## 启动与检查

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web api
```

默认入口为 `http://localhost:8086`。Web/Nginx 通过内部 DNS 服务名 `api` 代理 `/api` 和 `/mcp`；PostgreSQL 通过服务名 `db` 访问。只有 Web 的 `8086` 端口绑定到宿主机 `127.0.0.1`，API 和 PostgreSQL 都没有宿主机端口。

Compose 网络由 Docker 自动分配地址，服务发现不依赖固定子网。网络设置为 `internal: true`，容器间仍可按服务名通信，但不会直接接入外部网络。

API 健康检查：

- `/healthz`：进程存活。
- `/readyz`：数据库可连接且媒体目录可写。

## 相对数据目录

Compose 使用 bind mount：

- `./data/postgres:/var/lib/postgresql/data`
- `./data/media:/data/media`

两个目录均被 Git 忽略。Compose 会覆盖镜像的非 root 用户，让 API 以 root 运行，从而直接管理 bind-mounted `data/media`，无需单独的权限初始化容器。不要使用 `docker compose down -v` 作为数据管理方式，也不要直接删除 `data/`。

## 备份

数据库逻辑备份：

```bash
mkdir -p backups
docker compose exec -T db \
  pg_dump -U jifo -d jifo -Fc > backups/jifo.dump
```

同时备份 `data/media`。数据库与媒体必须使用相同时间点，并复制到部署主机之外。

## 更新

```bash
git pull
docker compose up -d --build
docker compose logs --tail=100 web api
```

API 会在 advisory lock 保护下执行尚未应用的 migration。不要修改已执行的 migration。

## 反向代理与 TLS

仓库根目录包含可直接使用的 `Caddyfile`。默认代理 `127.0.0.1:8086`；生产环境示例：

```bash
export JIFO_SITE_ADDRESS=notes.example.com
export JIFO_UPSTREAM=127.0.0.1:8086
caddy run --config ./Caddyfile
```

Caddy 会为有效公网域名自动申请和续期 HTTPS 证书。若使用 Caddy、Traefik 或宿主机 Nginx：

1. 保持 Compose 中的 `HTTP_PORT` 仅绑定到宿主机 `127.0.0.1`。
2. 在外层代理终止 TLS。
3. 保留 `X-Forwarded-For` 与 `X-Forwarded-Proto`。
4. API 默认信任 RFC1918 私网中的内部代理；只有在 Docker 使用非私网自定义地址池时，才需要在 `.env` 中覆盖 `TRUSTED_PROXIES`。
5. 定期轮换数据库密码、JWT 密钥和访问密钥。

## 停机

```bash
docker compose down
```

API 接收 `SIGTERM` 后会优雅停机；默认 Compose 停机宽限期为 30 秒。
