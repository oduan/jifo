# 后端部署指南

本文档覆盖 Jifo API 与 PostgreSQL 的单机 Docker Compose 部署。公网入口、TLS 与反向代理由部署环境单独负责，不在这里配置。

## 准备配置

复制示例环境变量文件：

```bash
cp .env.production.example .env.production
```

必须替换：

- `POSTGRES_PASSWORD`：数据库强密码。
- `JWT_SECRET`：至少 32 字节的密码学随机值；修改它会使现有 JWT 失效。
- `TRUSTED_PROXIES`：只有确切知道代理请求来源地址或 CIDR 时才设置。留空时后端不会信任任何客户端提交的 `X-Forwarded-For`。

环境文件不得提交到 Git，也不应出现在日志或工单中。

access token 默认 15 分钟过期，可通过 `ACCESS_TOKEN_TTL` 调整；客户端应使用轮换 refresh token 续期。

## 启动

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

API 只发布到宿主机回环地址 `127.0.0.1:8080`。PostgreSQL 不发布宿主机端口。API 启动时会在 advisory lock 保护下执行尚未应用的 migration。

检查服务：

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
```

- `/healthz` 只表示进程存活。
- `/readyz` 同时验证数据库可连接和媒体目录可写。

## 数据持久化

Compose 创建两个命名卷：

- `jifo_pgdata`：PostgreSQL 数据。
- `jifo_media`：上传媒体。

删除容器不会删除命名卷。不要在未确认备份的情况下执行 `docker compose down -v`。

## 备份

数据库与媒体必须一起纳入备份，并复制到宿主机之外的位置。数据库逻辑备份示例：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  pg_dump -U jifo -d jifo -Fc > jifo.dump
```

恢复必须在隔离环境定期演练：先恢复 PostgreSQL，再恢复对应时间点的媒体卷，最后启动相同或兼容版本的 API 并检查 `/readyz`。生产环境应通过备份系统执行加密、异地复制和保留策略，而不是仅把备份留在部署主机。

## 更新

更新前先备份，然后：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build api
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 api
```

不要修改已经在生产数据库执行过的 migration 文件；schema 变更必须新增 migration。

## 自动清理

API 内置单实例安全的清理 worker：

- 默认每小时扫描一次。
- 每批最多永久删除 500 条到期回收站笔记。
- PostgreSQL advisory lock 防止多实例重复执行。
- 无引用且创建超过 24 小时的媒体会被标记并清理。
- 清理任务有独立超时，失败只记录日志，不会终止 API。

可通过 `CLEANUP_INTERVAL` 和 `CLEANUP_TIMEOUT` 调整。

## 停机

容器收到 `SIGTERM` 后，API 停止接收新请求，并在超时时间内等待请求和清理 worker 退出。Compose 的 `stop_grace_period` 为 30 秒，后端默认 shutdown timeout 为 15 秒。
