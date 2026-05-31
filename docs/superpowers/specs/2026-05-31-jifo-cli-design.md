# Jifo CLI 与 Agent Skill 设计文档

**日期：** 2026-05-31  
**范围：** 新增独立 Go 命令行客户端，并提供项目级 skill 让 AI agent 通过 CLI 访问 Jifo 笔记与标签。  
**技术栈：** Go、Cobra、标准库 HTTP client、JSON、Jifo 现有 HTTP API。  

---

## 1. 目标

为 Jifo 增加一个独立命令行版本，满足两类使用者：

- 人类用户可以在终端中登录、查询笔记、搜索笔记、按标签查询、分页查询、创建纯文本笔记、查看标签列表或标签树。
- AI agent 可以通过稳定的 `--json` 输出调用 CLI，读取笔记、标签，或写入纯文本笔记。

本次只实现文本笔记能力，不处理图片上传、富媒体嵌入或离线同步 outbox。CLI 不直接连接数据库，只通过现有后端 HTTP API 工作。

---

## 2. 已确认决策

- CLI 放在新的独立目录 `cli/`，拥有自己的 `go.mod`。
- CLI 使用 Go 实现，并使用 Cobra 构建命令与帮助信息。
- 登录方式是提供 Jifo 设置里生成的 access key；该 key 作为 `Authorization: Bearer <token>` 访问后端。
- 认证信息支持两种来源：
  1. 配置文件 `~/.jifo/config.json`。
  2. 环境变量 `JIFO_ACCESS_TOKEN` 覆盖配置文件 token。
- Base URL 支持两种来源：
  1. 配置文件中的 `baseUrl`。
  2. 环境变量 `JIFO_BASE_URL` 覆盖配置文件 URL。
- 默认输出面向人类可读；所有数据查询与写入命令支持 `--json`，供 AI agent 和脚本稳定解析。

---

## 3. 非目标

- 不实现图片或附件上传。
- 不实现本地离线缓存、冲突解决或 sync push/pull 客户端。
- 不实现用户名密码登录；access key 由现有 Web 设置界面创建。
- 不新增后端 API，除非实现过程中发现现有 API 无法满足已列命令。
- 不在 skill 中保存或展示 access key。

---

## 4. 目录结构

新增目录结构：

```text
cli/
  go.mod
  go.sum
  cmd/
    jifo/
      main.go
  internal/
    api/
      client.go
      client_test.go
      types.go
    commands/
      root.go
      root_test.go
      auth.go
      auth_test.go
      notes.go
      notes_test.go
      tags.go
      tags_test.go
    config/
      config.go
      config_test.go
    output/
      output.go
      output_test.go
.agents/
  skills/
    jifo-cli/
      SKILL.md
```

职责边界：

- `cmd/jifo/main.go` 只负责调用命令入口并处理退出码。
- `internal/commands` 负责 Cobra 命令、flag、参数校验、组合 config/api/output。
- `internal/api` 负责 HTTP 请求、鉴权 header、query 参数、JSON 编解码、错误响应解析。
- `internal/config` 负责默认路径、读写配置、环境变量覆盖。
- `internal/output` 负责人类可读输出与 JSON 输出。
- `.agents/skills/jifo-cli/SKILL.md` 负责告诉 AI agent 如何安全、稳定地调用 CLI。

---

## 5. 配置与认证设计

默认配置路径为用户 home 下：

```text
~/.jifo/config.json
```

配置格式：

```json
{
  "baseUrl": "http://localhost:8080/api",
  "accessToken": "jifo_xxx"
}
```

运行时解析顺序：

1. 读取配置文件；不存在时使用空配置。
2. 如果 `baseUrl` 为空，使用默认 `http://localhost:8080/api`。
3. 如果存在 `JIFO_BASE_URL`，覆盖 `baseUrl`。
4. 如果存在 `JIFO_ACCESS_TOKEN`，覆盖 `accessToken`。

安全要求：

- `jifo login` 可以把 token 写入配置文件。
- `jifo logout` 只清除配置文件中的 access token，保留 base URL。
- `jifo status` 不输出完整 token，只显示是否已配置 token、base URL、token 来源。
- 错误信息和日志不打印 access token。

---

## 6. 命令设计

### 6.1 登录与状态

```bash
jifo login --token <access-key> [--base-url http://localhost:8080/api]
jifo logout
jifo status
```

行为：

- `login` 校验 `--token` 非空，写入配置文件；如果指定 `--base-url`，同时写入。
- `logout` 清空配置文件 token。
- `status` 显示 base URL、token 是否存在、token 来源是 env/config/none。

### 6.2 笔记查询

```bash
jifo notes list [--search TEXT] [--tag PATH] [--limit N] [--offset N] [--trash] [--json]
```

映射到现有 API：

```http
GET /notes?search=&tagPath=&trash=&limit=&offset=
Authorization: Bearer <token>
```

默认人类输出：每条笔记展示短 ID、创建时间、更新时间、版本、纯文本预览。  
JSON 输出：直接输出 `{ "items": [...] }`，保留后端字段，方便 agent 解析。

分页规则：

- `--limit` 和 `--offset` 只在用户提供时发送。
- 如果用户提供负数，CLI 返回参数错误，不发送请求。

### 6.3 笔记创建

```bash
jifo notes create --text TEXT [--json]
jifo notes create --file note.txt [--json]
```

映射到现有 API：

```http
POST /notes
Authorization: Bearer <token>
Content-Type: application/json
```

请求体：

```json
{
  "clientId": "cli-<uuid-or-random>",
  "content": {
    "blocks": [
      { "type": "paragraph", "text": "纯文本内容" }
    ]
  },
  "plainText": "纯文本内容"
}
```

规则：

- `--text` 与 `--file` 必须且只能提供一个。
- 文件按 UTF-8 文本读取。
- 空白内容返回参数错误。
- 初版将整个文本作为一个 paragraph block；后端依赖 `plainText` 解析标签。
- 默认输出创建成功后的 ID、时间与预览；`--json` 输出后端 `{ "item": ... }`。

### 6.4 标签查询

```bash
jifo tags list [--json]
jifo tags tree [--json]
```

映射：

```http
GET /tags
GET /tags/tree
```

默认人类输出：

- `tags list` 输出 path、note count。
- `tags tree` 用缩进展示层级、path 与 note count。

JSON 输出：保留后端 `{ "items": [...] }`。

---

## 7. HTTP Client 设计

`internal/api.Client` 接收：

- `BaseURL string`
- `AccessToken string`
- `HTTPClient *http.Client`

公开方法：

```go
type Client struct { ... }

type ListNotesParams struct {
    Search string
    TagPath string
    Trash bool
    Limit *int
    Offset *int
}

func (c *Client) ListNotes(ctx context.Context, params ListNotesParams) (NotesResponse, error)
func (c *Client) CreateNote(ctx context.Context, input CreateNoteInput) (NoteResponse, error)
func (c *Client) ListTags(ctx context.Context) (TagsResponse, error)
func (c *Client) TagTree(ctx context.Context) (TagTreeResponse, error)
```

错误处理：

- 缺 token 时，命令层返回明确提示：请先 `jifo login --token ...` 或设置 `JIFO_ACCESS_TOKEN`。
- HTTP 4xx/5xx 时，解析后端统一错误响应中的 `code`、`message`、`requestId`。
- 非 JSON 错误响应时，返回 HTTP status 和截断后的响应体。
- 网络错误保留原始错误上下文。

---

## 8. 输出设计

默认输出偏向终端阅读：

```text
ID        Created              Preview
1a2b3c4d  2026-05-31 09:10     今天开始写 #思考
```

标签树示例：

```text
电视剧 (3)
  电视剧/电视剧1 (1)
思考 (5)
```

`--json` 输出要求：

- 输出合法、稳定 JSON。
- 不额外混入提示文字。
- 错误仍走 stderr，人类可读即可；后续如果需要机器可读错误再扩展 `--json` 错误结构。

---

## 9. Agent Skill 设计

新增项目级 skill：

```text
.agents/skills/jifo-cli/SKILL.md
```

skill 触发场景：agent 需要通过 Jifo CLI 查询、搜索、分页读取、按标签读取、创建纯文本笔记或读取标签时。

skill 内容要覆盖：

- 调用前确认 `jifo` 可执行文件存在，或使用仓库内 `go run ./cmd/jifo`。
- 查询类命令优先加 `--json`，避免解析人类输出。
- 使用 `JIFO_ACCESS_TOKEN` 与 `JIFO_BASE_URL` 适配无状态自动化环境。
- 不在回复、日志或命令示例中泄露真实 access token。
- 常用命令示例：
  - `jifo notes list --search "关键词" --json`
  - `jifo notes list --tag "思考" --limit 20 --offset 0 --json`
  - `jifo notes create --text "内容 #标签" --json`
  - `jifo tags tree --json`

由于这是一个新 skill，实施时按 writing-skills 的 TDD 流程处理：先写 pressure scenario，观察没有 skill 时 agent 容易遗漏 `--json` 或泄露 token 的基线行为，再写 SKILL.md 并验证。

---

## 10. 测试策略

代码实现遵循 TDD：先写失败测试，再写最小实现。

测试覆盖：

- `internal/config`
  - 默认 base URL。
  - 配置文件读写。
  - `JIFO_BASE_URL` 与 `JIFO_ACCESS_TOKEN` 覆盖配置文件。
  - `logout` 清除 token 但保留 base URL。
- `internal/api`
  - 请求路径与 query 参数正确。
  - `Authorization: Bearer ...` header 正确。
  - POST `/notes` 请求体正确。
  - 后端错误响应被解析为可读错误。
- `internal/commands`
  - Cobra 命令参数校验。
  - `notes list` 正确调用 client 并输出。
  - `notes create` 校验 `--text` / `--file` 互斥与必填。
  - `--json` 输出不混入额外文本。
- `internal/output`
  - 笔记列表、标签列表、标签树的人类输出稳定。
  - JSON 输出可被 `encoding/json` 解析。
- skill
  - `SKILL.md` 通过 skill validator。
  - pressure scenario 验证 agent 会优先使用 `--json` 且不泄露 token。

最终验证命令：

```bash
cd cli
go test ./...
go run ./cmd/jifo --help
```

如修改 README 或文档示例，还需要人工检查示例命令与实际 Cobra help 一致。

---

## 11. 风险与缓解

### 11.1 配置文件安全

风险：access key 以明文保存在 `~/.jifo/config.json`。  
缓解：MVP 先采用简单配置文件；`status` 不显示完整 token；文档提醒可用 `JIFO_ACCESS_TOKEN` 避免落盘。后续可增加系统 keychain。

### 11.2 后端 tags list 字段大小写

风险：`GET /tags` 当前示例返回 `ID`、`Name`、`Path` 等 Go 导出字段大小写，而 tree 返回小写 JSON 字段。  
缓解：CLI 的 tag 类型同时兼容当前响应字段；人类输出主要依赖 path/name/note count。若后端未来统一字段，CLI 测试应覆盖兼容行为。

### 11.3 独立 module 依赖管理

风险：`cli/` 独立 `go.mod` 会增加一个模块维护点。  
缓解：CLI 与 backend 不共享内部包，通过 HTTP 边界解耦；README 明确 `cd cli && go test ./...`。

---

## 12. 验收标准

- 可以在 `cli/` 下运行 `go test ./...` 并通过。
- `jifo login --token <access-key>` 能保存配置。
- `JIFO_ACCESS_TOKEN` 能覆盖配置文件 token。
- `jifo notes list --search ... --json` 能调用 `/notes?search=...`。
- `jifo notes list --tag ... --limit ... --offset ... --json` 能调用标签筛选与分页。
- `jifo notes create --text ... --json` 能创建纯文本笔记。
- `jifo tags list --json` 与 `jifo tags tree --json` 能读取标签。
- 默认输出适合人类阅读；`--json` 输出合法 JSON。
- `.agents/skills/jifo-cli/SKILL.md` 存在，并说明 AI agent 使用 CLI 的认证、安全与 JSON 输出约定。
