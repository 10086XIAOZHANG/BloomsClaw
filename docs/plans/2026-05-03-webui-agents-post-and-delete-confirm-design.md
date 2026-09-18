# WebUI Agents POST And Delete Confirm Design

## Context

`agents` 页面有两个交互问题：

- 新建 Agent 会错误地走 `PUT`，而不是 `POST`
- 删除 Agent 没有二次确认

## Decision

采用最小修复方案：

- 新建 Agent 的初始 `id` 设为空字符串
- 保持 `saveAgentItem()` 现有的 `id` 判定逻辑不变
- 删除按钮增加二次确认

## Behavior

- 新建项：`id === ''`，保存时调用 `POST /agents`
- 已存在项：`id === name`，保存时调用 `PUT /agents/:name`
- 删除已保存项：用户确认后调用 `DELETE /agents/:name`
- 删除未保存项：用户确认后仅从表单移除，不发请求
