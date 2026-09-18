# WebUI Tools Toggle And Agents Tools Design

## Context

`tools` 页面已经切换为从后端读取数据，但启用状态切换仍通过本地 `saveToolsConfig()` 保存。

`agents` 页面中的 Tools 下拉尚未接入后端数据，当前直接置为空数组。

## Decision

采用最小联调方案：

- `tools` 页面只对接“启用状态切换”能力。
- `agents` 页面只加载已启用的工具作为下拉选项。
- 本次不实现 tools 的新增、编辑、删除。

## Service Changes

- 新增 `saveToolItem(tool: ToolItem)`。
- 使用 `PUT /tools/:name` 更新单个工具。
- 请求体字段映射：
  - `name`
  - `description`
  - `active`
  - `builtin`
- 保存成功后统一返回 `getImoocClawToolsConfig()` 的最新结果。

## Page Changes

### Tools Page

- `handleToggle()` 只更新当前工具。
- 保留乐观更新，接口失败时回滚并提示错误。

### Agents Page

- `loadConfig()` 并行读取：
  - `agents`
  - `models`
  - `tools`
- 仅将 `enabled=true` 的工具写入下拉选项。

## Scope

本次只完成：

- tools 启用状态切换走后端
- agents tools 下拉接入后端并过滤已启用工具
