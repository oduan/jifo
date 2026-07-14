# Docker 部署指南

本文档说明如何使用 Docker Compose 部署 Jifo Web、API 与 PostgreSQL。默认拓扑为：

```text
Browser → Web (Nginx) → API (Go) → PostgreSQL
                         └→ data/media
```

## 准备配置

```bash
cp .env.production.example .env.production
```

必须替换 `POSTGRES_PASSWORD` 和 `JWT_SECRET`。生产环境的 `JWT_SECRET` 至少 32 字节。

## 启动与检查

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 web api
```

默认入口为 `http://localhost:8080`。Web 通过内部网络代理 `/api`，API 和 PostgreSQL 不直接暴露到公网；数据库端口仅绑定 `127.0.0.1`。

API 健康检查：

- `/healthz`：进程存活。
- `/readyz`：数据库可连接且媒体目录可写。

## 相对数据目录

Compose 使用 bind mount：

- `./data/postgres:/var/lib/postgresql/data`
- `./data/media:/data/media`

`media-init` 容器会在 API 启动前准备媒体目录权限。两个目录均被 Git 忽略。不要使用 `docker compose down -v` 作为数据管理方式，也不要直接删除 `data/`。

## 备份

数据库逻辑备份：

```bash
mkdir -p backups
docker compose --env-file .env.production exec -T db \
  pg_dump -U jifo -d jifo -Fc > backups/jifo.dump
```

同时备份 `data/media`。数据库与媒体必须使用相同时间点，并复制到部署主机之外。

## 更新

```bash
git pull
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs --tail=100 web api
```

API 会在 advisory lock 保护下执行尚未应用的 migration。不要修改已执行的 migration。

## 反向代理与 TLS

若使用 Caddy、Traefik 或宿主机 Nginx：

1. 将 `HTTP_PORT` 仅绑定到可信入口或防火墙限制的地址。
2. 在外层代理终止 TLS。
3. 保留 `X-Forwarded-For` 与 `X-Forwarded-Proto`。
4. 根据实际 Compose 子网配置 `TRUSTED_PROXIES`。
5. 定期轮换数据库密码、JWT 密钥和访问密钥。

## 停机

```bash
docker compose --env-file .env.production down
```

API 接收 `SIGTERM` 后会优雅停机；默认 Compose 停机宽限期为 30 秒。
