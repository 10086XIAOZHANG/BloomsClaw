# Agent Core Design

## Context

仓库根目录已经通过 `workspaces` 纳入 `apps/*` 与 `packages/*`。

当前 `packages/` 目录为空，需要新增一个智能体相关的子包，作为后续能力实现的承载位置。

## Decision

采用方案 A，创建最小 `TypeScript SDK` 骨架：

- 路径为 `packages/agent-core`
- `package.json` 中的 `name` 固定为 `@blooms-claw/agent-core`
- 仅创建基础工程文件，不提供任何具体功能实现

## Scope

本次包含：

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `README.md`

本次不包含：

- 智能体抽象类型
- 工具系统
- 运行时执行器
- 上下文管理
- 自动化测试

## Notes

该子包创建后会被根目录 `workspaces` 自动识别，无需额外修改 monorepo 配置。
