# BloomsClaw MCP Demo Server

本地测试用 MCP Server，用于验证 `WebUI -> API -> agent-core` 整条 MCP 链路。
提供两种传输：`stdio`（本地子进程）与 `streamableHttp`（本地 HTTP）。

## 安装

```bash
cd mcp-server
pnpm install
```

## 方式一：stdio（本地子进程）

```bash
node index.js
```

正常启动后无任何输出（`stdio` 等待 JSON-RPC 输入即为正常）。

在 WebUI 里配置 `Tools -> 新建 MCP 工具`：

- 名称：`demo`
- 描述：`本地测试 MCP`
- 传输方式：`stdio`
- 启动命令：`node`
- 启动参数（每行一个）：

```text
/Users/jack/Downloads/DeepAgents/fils/blooms_claw/mcp-server/index.js
```

- 环境变量：留空
- 工作目录：留空

## 方式二：streamableHttp（本地 HTTP）

先起服务（默认 `3100`，可用 `MCP_HTTP_PORT` 改端口）：

```bash
node http.js
# MCP_HTTP_PORT=3101 node http.js
```

看到以下输出即为正常：

```text
[mcp-demo-http] listening on http://localhost:3100/mcp
```

在 WebUI 里配置 `Tools -> 新建 MCP 工具`：

- 名称：`demo-http`
- 描述：`本地 HTTP 测试 MCP`
- 传输方式：`streamableHttp`
- 服务端地址（注意必须带 `/mcp` 路径，裸域名会 404）：

```text
http://localhost:3100/mcp
```

- 请求头：留空

健康检查：`curl http://localhost:3100/health` 应返回 `{"ok":true}`。

点 `创建并测试连接`，成功后点 `测试连接并查看远端工具`，应看到：

```text
echo / add / now
```

实际注入给模型的名字是 `demo__echo`、`demo-http__echo` 等（`<server>__<tool>`）。

## 快速手动验证（不经过 WebUI）

```bash
# 列出远端工具
node -e "
import('./index.js');
" 2>/dev/null
```

更直接的是走 `API`：

```bash
curl -s http://localhost:3000/tools | python3 -m json.tool
curl -s http://localhost:3000/tools/demo/remote-tools | python3 -m json.tool
```

## 工具说明

| 远端 tool | 参数 | 返回 |
|---|---|---|
| `echo` | `{ text: string }` | `echo:<text>` |
| `add` | `{ a: number, b: number }` | `a+b` 的字符串 |
| `now` | 无 | ISO 时间字符串 |
