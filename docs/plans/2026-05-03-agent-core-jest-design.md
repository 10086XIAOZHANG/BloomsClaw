# Agent Core Jest Design

## Context

`packages/agent-core` 已经具备最小 TypeScript 子包骨架，并且当前 `src/index.ts` 已导出 `createAgent()`。

现在需要为该子包补充最小可用的 Jest 测试能力，便于后续围绕智能体核心逻辑补充单元测试。

## Decision

采用方案 A，使用 `Jest + ts-jest`：

- 在 `package.json` 中新增测试脚本
- 引入 `jest`、`ts-jest`、`@types/jest` 作为开发依赖
- 使用独立的 `jest.config.cjs` 保存测试配置
- 新增一个最小单元测试，覆盖 `createAgent('')` 的异常分支

## Scope

本次包含：

- 测试运行脚本
- Jest 配置文件
- 一个最小示例测试

本次不包含：

- 针对文件系统的 mock 测试
- 覆盖 `console.log` 输出的断言
- 更复杂的测试目录约定

## Notes

当前包使用 `"type": "module"`，因此 Jest 配置文件使用 `jest.config.cjs`，避免额外的 ESM 配置复杂度。
