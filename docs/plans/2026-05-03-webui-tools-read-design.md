# WebUI Tools Read Design

## Context

`tools` 页面仍通过 `getImoocClawConfig()` 从本地 mock 配置读取数据，后端 `tools` CRUD 已完成，需要把页面读取切换到真实接口。

## Decision

采用方案 C：

- 新增 `getImoocClawToolsConfig()`，从 `GET /tools` 读取工具配置。
- 前端 `ToolItem` 移除 `category` 字段。
- `tools` 页面不再展示 `category`，改为直接展示 `builtin` 状态。

## Mapping

后端 `ToolDto`：

```ts
{
  name: string;
  description: string;
  active: 0 | 1;
  builtin: 0 | 1;
}
```

前端 `ToolItem`：

```ts
{
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
}
```

映射规则：

- `id = name`
- `builtin = builtin === 1`
- `enabled = active === 1`

## Scope

本次只切换读取逻辑。

`handleToggle()` 仍保留现有本地保存实现，后续如果继续联调，再把工具启停切换到后端 `PUT /tools/:name`。
