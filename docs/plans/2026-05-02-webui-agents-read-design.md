# WebUI Agents Read Design

## Goal

Switch the `agents` page in `apps/webui` from local mock config loading to the backend `GET /agents` API.

## Scope

- Add `getImoocClawAgentsConfig` in the web UI service layer.
- Read `http://localhost:3000/agents`.
- Map backend agent fields to the current page form shape.
- Update the agents page to use the new read API only.
- Enable CORS in the Nest API so browser requests from the web UI can succeed.

## Mapping

Backend agent DTO:

```json
{
  "name": "coding-assistant",
  "model": "qwen3.6-plus",
  "tools": ["tool1", "tool2"],
  "description": "desc",
  "active": 1,
  "systemPrompt": "prompt"
}
```

Current page `AgentItem` shape:

```json
{
  "id": "coding-assistant",
  "name": "coding-assistant",
  "modelId": "qwen3.6-plus",
  "toolIds": ["tool1", "tool2"],
  "description": "desc",
  "enabled": true,
  "systemPrompt": "prompt"
}
```

## Notes

- `id` temporarily uses `name` as a stable key for read-only integration.
- `models` and `tools` remain empty in this step.
- Save and delete are intentionally left for a later step.
