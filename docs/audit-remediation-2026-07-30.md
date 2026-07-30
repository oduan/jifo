# Jifo 全面审计与修复记录（2026-07-30）

## 结论

本轮按“数据隔离与丢失风险 → 同步一致性 → 认证安全 → 数据生命周期 → 性能与边界 → 构建供应链”的顺序完成修复。所有已识别的阻断级和高风险问题均已落地并通过自动化验证；修改保留在当前工作区，尚未提交或推送。

## 修复计划与完成状态

1. **账号、服务器与本地数据隔离（已完成）**
   - Android Room 会话增加 `userId`，数据库升级到 v3。
   - 无法确认旧缓存归属的升级场景执行一次性本地缓存/outbox 清理。
   - 切换账号、服务器、退出登录及 refresh 401 都清理凭据、笔记、标签、热力图、待上传媒体、outbox 和同步游标。
   - 同步事务校验启动时账号，阻止旧账号的在途响应在切换后回写；Worker 正确传播协程取消。
   - Android 平台备份与设备迁移均排除令牌和本地数据。

2. **离线同步正确性与冲突恢复（已完成）**
   - Web `create` 不再发送本地临时 `noteId`。
   - 合并 `create + update`、取消 `create + delete`，压缩连续 `update`，但不合并语义不安全的混合操作。
   - Android 正确处理 `already_trashed`、`conflict_copied`、`delete_conflict_ignored`。
   - 发生更新/删除冲突时清空增量游标并完整对账，避免原始笔记因先前跳过而永久保留乐观本地内容。
   - 永久 tombstone 会删除客户端缓存和相关 outbox，防止陈旧数据复活。
   - 单次同步 push 上限为 500 个操作。

3. **认证刷新并发与跨标签页状态（已完成）**
   - 新增 refresh-token family 表和 1 分钟丢包/并发重试宽限窗口。
   - 宽限期后的旧令牌重放会撤销整个会话；迁移前的 previous token 也保留重放检测能力。
   - Web 同一标签页复用一条 refresh promise，多个标签页通过 storage event 同步登录状态。
   - 在途旧 refresh 的成功或 401 不再覆盖/清空后来登录的新账号。
   - Android 复用按 base URL 缓存的 API client，减少客户端内部的重复 refresh 竞争。

4. **永久删除、媒体并发与保留策略（已完成）**
   - 永久删除同时清空 `content` 与 `plain_text`，只保留同步所需 tombstone。
   - 无引用媒体给予 7 天宽限期。
   - 媒体清理在物理删除前锁行并复查笔记和头像引用；笔记重新引用同样获取该锁并恢复待删媒体。
   - 不存在或已清理的媒体返回稳定的 `media_unavailable` 错误。
   - 定期删除过期 refresh rows、陈旧会话、365 天前的幂等记录及长期失效访问密钥；永久笔记 tombstone 暂不删除，避免无同步水位时复活。

5. **查询、标签和输入边界（已完成）**
   - 标签树支持任意深度，不再因值拷贝只构建两层。
   - Web 离线标签过滤改为完整路径/子路径匹配，避免 `#foo` 误匹配 `#foobar`。
   - 热力图拒绝反向日期并限制为最多 366 天。
   - 访问密钥有效期限制为 1–3650 天（留空/0 仍表示永久）。
   - Web 过滤变化直接重新加载数据；旧的首页、离线缓存和“加载更多”响应均不能覆盖新筛选结果。
   - 为活跃笔记和回收站的 keyset 分页增加在线并发索引。

6. **迁移可靠性（已完成）**
   - advisory lock 始终由同一条专用 PostgreSQL 连接持有和释放。
   - 迁移记录 SHA-256；校验前规范化 CRLF/LF，保证 Windows 与 Linux 一致。
   - 支持带 `jifo:no-transaction` 标记的并发索引迁移。
   - 保留历史 008 内容不变，新增幂等在线索引修复迁移，避免修改已经发布的历史文件。
   - 集成测试统一重置所有应用表；CI 对共享测试数据库按包串行执行，消除跨包删表污染。

7. **部署、依赖与供应链（已完成）**
   - Compose API 不再以 root 运行；一次性 `media-init` 初始化 bind mount 权限。
   - PostgreSQL 密码通过标准 `PG*` 变量传入，避免连接 URL 转义错误。
   - CLI 默认地址与 Compose 的 `8086` 入口一致。
   - 更新 Go、Web 依赖和锁文件；增加 Go/NPM/Gradle/GitHub Actions Dependabot。
   - 新增后端、CLI、Web、Android CI；GitHub Actions 全部固定到已核对的提交 SHA。

8. **文档与回归测试（已完成）**
   - README、Android、自托管、开发、API 和同步文档均与当前行为同步。
   - 新增账号切换、在途 refresh、冲突对账、永久 tombstone、离线标签精确匹配、push 上限及迁移校验等回归测试。

## 当前实现的主要能力

- 邮箱注册/登录、access/refresh token、退出与修改密码、多设备会话。
- 文本和图片笔记、搜索、回收站/恢复、30 天后永久删除。
- 层级标签、标签重命名/删除、活动热力图。
- Web IndexedDB 与 Android Room 离线缓存、outbox、媒体先上传、幂等 push 和增量 pull。
- 访问密钥、CLI、带 Bearer 鉴权的 MCP Streamable HTTP。
- Docker Compose 自托管、Android 运行时选择服务器、tag 触发的签名 APK 发布流程。

## 验证结果

- 后端：PostgreSQL 16 临时实例上 `go test -p 1 ./...` 全部通过；`go vet ./...` 通过。
- 后端与 CLI：`govulncheck` 未发现可达漏洞；CLI `go test ./...`、`go vet ./...` 通过。
- Web：19 个测试文件、139 项测试全部通过；TypeScript、ESLint、Vite 生产构建通过；`npm audit` 为 0。
- Android：`testDebugUnitTest` 与 `lintDebug` 通过，lint 为 0 error。
- 部署：`docker compose config --quiet` 通过；迁移 001–012 已在真实 PostgreSQL 上从空库完整执行并二次幂等执行。
- 仓库：`git diff --check` 通过；CI action SHA 与各官方版本标签核对一致。

## 已知非阻断项

- Android lint 仍报告 127 个 warning，主要是中文硬编码资源（49）、依赖可升级提示（31）、未使用资源、布局/无障碍建议和 KAPT→KSP 建议；没有 error。大版本 AndroidX/Retrofit/OkHttp/Coil、compile/target SDK 36 及 KSP 迁移需要单独的兼容性与真机回归，不在本轮自动升级。
- Gradle 构建仍提示 Moshi KAPT codegen 将在未来版本移除；当前构建和测试正常，Dependabot 已覆盖 Gradle 依赖。
- 尚未在真实手机、多浏览器标签页和远程 GitHub Actions runner 上做人工端到端验收；本地自动化、真实 PostgreSQL 集成和配置验证均已完成。

