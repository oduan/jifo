# Jifo

Jifo 是一个类似 Flomo 的笔记 MVP：Go + PostgreSQL 后端、React Web、块结构图文笔记、嵌套标签、回收站、热力图、JWT 多设备用户体系、本地媒体基础能力，以及 Web 侧离线优先 outbox/sync 基础。

## 当前范围

已完成首版核心骨架：

- 后端：用户注册/登录、JWT access token 校验、多设备 session 基础、笔记创建/列表、标签解析与树、热力图、媒体/同步基础模块。
- Web：Vite + React + TypeScript、认证界面、Flomo-like 双栏笔记布局、笔记编辑器、标签树、热力图、IndexedDB cache/outbox、离线同步引擎基础。
- 存储：PostgreSQL；Web 本地缓存使用 Dexie/IndexedDB。

> 注意：HTTP 层的 `/api/sync/push` 和 `/api/media` 当前仍是最小占位路由；同步核心逻辑已在后端 service 与 Web sync engine 中落地，后续可继续接入完整 HTTP handler。

## 快速开始

```bash
docker compose up -d db

cd backend
DATABASE_URL=postgres://jifo:jifo@localhost:5432/jifo?sslmode=disable JWT_SECRET=dev-secret go run ./cmd/api

cd ../web
npm install
npm run dev
```

默认后端监听 `:8080`；Web dev server 由 Vite 输出本地地址。

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
- [设计文档](docs/superpowers/specs/2026-05-26-jifo-flomo-like-mvp-design.md)
- [实施计划](docs/superpowers/plans/2026-05-26-jifo-flomo-like-mvp-implementation-plan.md)
