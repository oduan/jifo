# Jifo MCP 服务

Jifo 在站点根路径提供标准 Streamable HTTP MCP 端点：

```text
https://notes.example.com/mcp
```

该端点与 REST API 共用用户和数据层。每个请求都必须携带：

```http
Authorization: Bearer <access-key-or-access-token>
```

推荐在 Web 设置中创建专用访问密钥供 agent 使用。访问密钥可单独撤销，而且不会像网页登录 access token 一样在较短时间后过期。生产环境必须使用 HTTPS，不要把访问密钥写入仓库。

服务采用无状态 Streamable HTTP，请求和响应使用 JSON；客户端只需配置 `/mcp` URL，不需要自行管理 session。

## 工具

| 工具 | 作用 |
| --- | --- |
| `search_notes` | 模糊搜索正文；可叠加标签路径、创建时间、更新时间和分页条件 |
| `create_note` | 创建纯文本笔记，自动解析正文中的 `#标签` |
| `update_note` | 替换指定笔记的完整正文并重建标签关联 |
| `search_tags` | 模糊搜索标签名称或完整路径，并返回对应笔记数量 |
| `list_tag_tree` | 返回完整标签树，每个节点包含对应笔记数量 |
| `rename_tag` | 修改标签名称，保留其当前父级，并同步更新关联笔记正文 |
| `delete_tag` | 删除标签；可选择只移除标签，或同时把关联笔记移入回收站 |

`search_notes` 和 `search_tags` 使用从 1 开始的 `page`。`page_size` 默认是 50，最大是 200。时间参数均为包含边界的 RFC 3339 时间戳，例如 `2026-07-01T00:00:00+08:00`。未传入的筛选条件不会参与查询，因此正文、标签和多个时间范围可以任意叠加。

`delete_tag` 的 `delete_notes` 默认为 `false`：

- `false`：仅从关联笔记正文中移除该标签，保留笔记。
- `true`：删除标签，并把所有直接关联的笔记移入回收站。

## Codex 配置

先把访问密钥放入本机环境变量：

```powershell
$env:JIFO_MCP_TOKEN = "jifo_..."
```

在 `~/.codex/config.toml` 或受信任项目的 `.codex/config.toml` 中添加：

```toml
[mcp_servers.jifo]
url = "https://notes.example.com/mcp"
bearer_token_env_var = "JIFO_MCP_TOKEN"
default_tools_approval_mode = "writes"
```

`writes` 会让 Codex 对未标记为只读的工具请求确认；`delete_tag` 还会声明 destructive hint。Codex 官方配置也支持命令行注册：

```powershell
codex mcp add jifo --url https://notes.example.com/mcp --bearer-token-env-var JIFO_MCP_TOKEN
```

可用以下命令检查配置：

```powershell
codex mcp get jifo --json
codex mcp list
```

Codex 的 Streamable HTTP MCP 配置字段以官方文档为准：<https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers>。

## 其他 MCP 客户端

选择 Streamable HTTP 传输，将服务 URL 设置为 `https://notes.example.com/mcp`，并为每个请求设置 `Authorization: Bearer ...`。服务支持当前官方 Go MCP SDK 所兼容的协议版本。若客户端只支持旧的 HTTP+SSE 传输，则需要升级客户端。

## 本地开发

直接启动 API 时使用 `http://127.0.0.1:8080/mcp`。通过 Vite 开发服务器或 Docker Web 入口访问时也可使用同源 `/mcp`；开发代理和 Nginx 都会把该路径转发到 API 服务。
