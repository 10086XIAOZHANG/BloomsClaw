# WebUI Models Temperature Width Design

## Context

模型配置页新增“从环境变量读取”开关后，`API Key`、开关和 `Temperature` 被放在同一行的三个等宽列中。

这导致 `Temperature` 输入框变窄，视觉上明显短于上一行的 `Base URL` 输入框。

## Decision

通过调整页面布局解决宽度问题：

- 将 `API Key` 和 `Temperature` 改为同一行的两个半宽列
- 将“从环境变量读取”开关移动到 `API Key` 区域下方
- 不修改任何接口、字段或保存逻辑

## Scope

本次只包含模型配置页的表单布局调整。
