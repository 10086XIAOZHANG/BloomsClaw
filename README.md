# Blooms Claw

> 一套**配置驱动的多智能体（Multi-Agent）AI 系统**：基于 DeepAgents + LangGraph 编排通用智能体，以「Skills 渐进式加载 + Docker 沙箱隔离 + MCP 工具生态」为核心方案，通过统一的 API 与 WebUI 面向多用户提供对话、文件操作、命令执行、联网检索、计算与自定义 Skill 能力。

---

## 目录

- [项目方案](#项目方案)
- [使用到的技能（Skills）](#使用到的技能skills)
- [架构总览](#架构总览)
- [目录结构](#目录结构)
- [核心能力](#核心能力)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [开发规划文档](#开发规划文档)

---

## 项目方案

### 1. 多智能体编排（Agent Orchestration）

- 采用 **DeepAgents**（LangChain 体系）的 `createDeepAgent` 提供通用智能体运行时，叠加 **LangGraph** 的持久化状态机（`checkpointer`）+ LangSmith 可观测性，支持多轮对话记忆与中断恢复。
- 智能体是**配置驱动**的：能力完全由 `~/.blooms_claw/blooms_claw.json`（或用户级配置）定义，包括 systemPrompt、模型、可选工具、MCP Servers 与 Skills，无需改代码即可新建/切换智能体。

### 2. Skills 渐进式加载（Progressive Skill Loading）

这是控制 long-context 的核心策略，把「Skill 内容注入」从一次性全量注入改成**按需分层加载**：

| 层级 | 内容 | 触发时机 |
|------|------|----------|
| **L1 常驻索引** | 仅注入 active Skills 的 `name + description`（约 200 token/Skill） | 组装 systemPrompt 时 |
| **L2 正文加载** | `load_skill` 工具按用户提问加载单个 SKILL.md 全文 | 模型命中索引后自行调用 |
| **L3 资源读取** | `read_skill_resource` 工具按需读取 references/、data/ 下的单个文件 | 模型执行 Skill 流程时 |

这样首轮不把全部 SKILL.md 塞进上下文，避免爆 context，同时保证模型「知道有什么、用的时候才取」。

### 3. Docker 沙箱隔离（Sandbox）

- 文件工具（FileTools）与命令执行工具（RunCommand）运行在**独立的 Docker 临时容器**（`sandbox` 服务，基于 Python + Node 镜像）中，与宿主机网络隔离。
- 通过 `DockerSandboxBackend` 对 `sandbox` 服务发 HTTP 请求执行 file/command；并提供一个 **Proxy 层 `_wrapBackendWithPathNormalization`** 对实参做路径规约，把宿主机绝对路径映射回沙箱内部相对路径，杜绝越权访问宿主机文件。
- systemPrompt 内置 workspace 守卫，禁止访问宿主机路径 / Docker socket / 外部工作区（唯一的例外是允许 Skill 自带 `scripts/*.py` 的绝对路径）。

### 4. MCP 工具生态（Model Context Protocol）

- 智能体可绑定一个或多个 **MCP Server**，通过 `loadMcpToolsForAgent` 按 agentConfig 按需建连并注入工具；仓库自带 `mcp-server` 演示服务（`echo`/`add`/`now` 等）。
- API 侧集成了 `@modelcontextprotocol/sdk`，WebUI 提供 Tools 开关。

### 5. 多模型 / 多服务端支持

- 模型通过 `initChatModel` 动态初始化，支持任意兼容 OpenAI 的 provider，可配置：`base_url`、`api_key`（也支持走环境变量 `use_env_api_key`）、`temperature`、`enable_thinking`。
- **按用户隔离**：所有配置、Skill、记忆（memory）均落在 `~/.blooms_claw/users/<userId>/` 下，未登录用户（`default`）再沿用全局配置。

### 6. 面向用户的分层应用

- **WebUI**：基于 React 19 + Umi/Max + Ant Design Pro 的界面，提供模型管理、智能体（agents）配置与 Tools 开关、对话（chatbot）、文件管理等页面；项目内置统一设计系统（`design-system/blooms-claw`）。
- **API**：NestJS 提供的 REST 服务层（auth / agents / models / tools / skills）。
- **部署**：`docker-compose.prod.yml` + Nginx 统一托管前端静态资源与后端服务。

---

## 使用到的技能（Skills）

本项目既**消费**技能，也**内建**了一套完整的 Skill 运行机制：

### 内建的 Skills 运行机制（agent-core）

- `load_skill`：按需加载 active Skill 的 SKILL.md 正文（L2）。
- `read_skill_resource`：按需读取 Skill 的 references/、data/ 二级资源文件（L3）。
- `buildSkillIndexPrompt`：生成 L1 常驻的 Skills 索引注入 systemPrompt。
- 配置项 `skills`（`skills-lock.json` 记录来源与锁定的 hash）：支持从本地 Markdown 或 GitHub 仓库安装技能并由 API 侧 `SkillsService` 统一管理（`install` / `list` / `read` 等）。
- **按用户隔离**：每个用户的 Skills 存于 `~/.blooms_claw/users/<userId>/skills/`。

### 当前已安装 / 使用的第三方技能

| Skill | 用途 | 来源 |
|-------|------|------|
| `ui-ux-pro-max` | 界面 / 组件 / 设计 / 样式相关的设计技能，随对话按需加载 | `nextlevelbuilder/ui-ux-pro-max-skill`（GitHub） |

设计侧另有一套 `design-system/blooms-claw` 的 **Design System Master**（色板、间距、动效等设计令牌），用于指导 WebUI 页面落地，构建页面时先查 `design-system/pages/<page>.md`，存在则以其覆盖 Master。

---

## 架构总览

```
             ┌────────────────────────────────────────────┐
             │              WebUI (React/Umi/Max)          │
             │  模型 · 智能体 · Tools 开关 · 对话 · 文件管理  │
             └──────────────────────┬─────────────────────┘
                                    │ HTTP / REST
             ┌──────────────────────▼─────────────────────┐
             │              API (NestJS, :3000)            │
             │  auth · agents · models · tools · skills    │
             │            SkillsService(安装/管理)          │
             └───────────────┬──────────────┬─────────────┘
                             │              │ MCP(按需建连)
                    ┌────────▼──────┐  ┌────▼─────────────┐
                    │  agent-core   │  │  mcp-server       │
                    │  DeepAgents   │  │  (Tool provider)  │
                    │  + LangGraph  │  └──────────────────┘
                    │  + LangSmith  │
                    └───────┬───────┘
                            │ file / shell (Docker 隔离)
                    ┌───────▼────────────────┐
                    │  sandbox (NestJS, 容器) │
                    │  文件操作 · 命令执行      │
                    └────────────────────────┘

  持久化: ~/.blooms_claw/
     记忆    users/<uid>/memory
     配置    blooms_claw.json
     Skills  skills/ + users/<uid>/skills/
```

---

## 目录结构

```
blooms_claw/
├── apps/
│   ├── api/            # NestJS 后端服务（auth/agents/models/tools/skills）
│   └── webui/          # React 19 + Umi/Max + Ant Design Pro 前端
├── packages/
│   └── agent-core/     # 核心智能体库（DeepAgents 集成、Skills、Tools、Docker 沙箱）
├── mcp-server/         # MCP 演示服务（echo/add/now 等）
├── sandbox/            # Docker 沙箱服务（文件/命令执行，路径越权防护）
├── deploy/
│   ├── docker/         # 生产镜像 Dockerfile
│   └── nginx/          # Nginx 反向代理 / 静态资源托管
├── design-system/
│   └── blooms-claw/    # 设计系统（MASTER.md + 页面规则）
├── docs/plans/         # 各模块设计文档（方案评审）
└── .claude/            # Claude Code 配置（settings.json）与 Skill 安装锁定
```

---

## 核心能力

| 能力 | 说明 | 实现 |
|------|------|------|
| 配置驱动智能体 | 通过 JSON 配置定义智能体，无需改码 | `readConfigByAgentName` |
| 多模型接入 | 任意 OpenAI 兼容 provider，支持 env-key / thinking / temperature | `initChatModel` |
| Skill 渐进加载 | L1 索引 → L2 正文 → L3 资源，控制上下文窗口 | `tools/skills.ts` |
| Docker 沙箱 | 文件与命令在隔离容器中执行，路径规约防越权 | `tools/sandbox.ts` + `sandbox` 服务 |
| MCP 工具 | 按 agentConfig 绑定并注入外部 MCP 工具 | `tools/mcp.ts` |
| 通用工具 | FileTools / RunCommand / WebSearch / Calculator | agent-core `tools/` |
| 多用户隔离 | 配置、Skill、记忆按 userId 分区 | `~/.blooms_claw/users/<uid>/` |
| 对话记忆 | LangGraph checkpointer 持久化多轮记忆 | `FileSaver` |
| 设计系统 | 统一的设计令牌指导 UI 落地 | `design-system/` |

---

## 快速开始

```bash
# 1. 安装依赖（pnpm workspace：apps/* + packages/*）
pnpm install

# 2. 构建核心包
npm run build -w packages/agent-core

# 3. 启动 Docker 沙箱服务（容器内隔离执行文件/命令）
docker compose -f docker-compose.yml up -d

# 4. 启动 API（NestJS，:3000）
npm run start:dev -w apps/api

# 5. 启动 WebUI（:8000）
npm run start -w apps/webui

# 6. mcp-server 可作为外部工具提供方按 agentConfig 绑定
```

> 环境变量：`BLOOMS_CLAW_WORKSPACES_DIR`（沙箱工作区目录）、`MAX_OUTPUT_BYTES`、`COMMAND_TIMEOUT_MS`（沙箱命令输出上限与超时）等。

---

## 配置说明

运行时配置集中在宿主机的 `~/.blooms_claw/blooms_claw.json`：

```jsonc
{
  "agents": {
    "agentName": {
      "systemPrompt": "智能体人设与行为",
      "modelConfig": {
        "id": "model-id",
        "provider": "openai",
        "base_url": "https://...",
        "api_key": "sk-...",
        "use_env_api_key": 0,      // 1 时从环境变量取值
        "temperature": 0.7
      },
      "tools": ["Calculator", "..."],  // 可选工具（FileTools/RunCommand/WebSearch 默认加载）
      // 可绑定 MCP Servers
    }
  }
}
```

技能启停由 API 侧 `SkillsService`（`install` / `list` / `read`）管理与 `skills-lock.json` 记录锁定版本。

---

## 开发规划文档

各模块的详细设计文档见 [docs/plans/](docs/plans/)，例如：

- `2026-05-03-agent-core-design.md` — agent-core 核心设计
- `2026-05-03-webui-agents-save-tools-design.md` — 智能体 Tools 保存设计
- `2026-05-03-webui-models-env-api-key-flag-design.md` — 模型环境变量 API Key 设计

---

## License

本项目为私有项目（`private: true`），无对外开源授权。

*Generated by Blooms Claw agent-core.*