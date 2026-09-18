# WebUI Agents Save Tools Design

## Context

`agents` 页面已经能从后端读取模型和工具下拉，但保存 Agent 时仍走本地 mock 配置，因此表单中选择的 `toolIds` 不会持久化到后端 `agents.tools` 字段。

## Decision

采用保存后重载关联数据的方案：

- `saveAgentItem()` 改为调用后端 `POST /agents` 或 `PUT /agents/:name`。
- 将前端 `toolIds` 映射为后端 `tools` 数组。
- 保存成功后重新读取 `agents`、`models`、`tools`，统一刷新页面状态。

## Mapping

前端 `AgentItem`：

```ts
{
  id: string;
  name: string;
  modelId: string;
  toolIds: string[];
  description: string;
  enabled: boolean;
  systemPrompt: string;
}
```

后端 `AgentDto`：

```ts
{
  name: string;
  model: string;
  tools: string[];
  description: string;
  active: 0 | 1;
  systemPrompt: string;
}
```

## Scope

本次只修复 Agent 保存链路。

- 保存时把 `toolIds` 写入后端。
- 保存成功后刷新 `agents/models/tools`。
- 不修改删除链路。
