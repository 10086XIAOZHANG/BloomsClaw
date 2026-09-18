# Agents CRUD Design

## Goal

Provide CRUD APIs for the `agents` key in `~/.imooc_claw/imooc_claw.json`.

## Scope

- Read all agent configs from the `agents` map.
- Read a single agent config by agent name.
- Create a new agent config by name.
- Replace an existing agent config by name.
- Delete an existing agent config by name.

## Data Model

The config file is a JSON object. The root object may contain other keys. This feature only manages the `agents` key.

```json
{
  "agents": {
    "agent-name": {
      "model": "qwen3.6-plus",
      "tools": ["tool1", "tool2"],
      "description": "agent description",
      "active": 1,
      "systemPrompt": "system prompt"
    }
  }
}
```

- `agents` stays as a map keyed by agent name in the config file.
- API input and output use the frontend-aligned shape:

```json
{
  "name": "agent-name",
  "model": "qwen3.6-plus",
  "tools": ["tool1", "tool2"],
  "description": "agent description",
  "active": 1,
  "systemPrompt": "system prompt"
}
```

## Architecture

- `AgentsController`: exposes REST APIs.
- `AgentsService`: owns CRUD rules and error handling.
- `ConfigFileService`: reads and writes `imooc_claw.json`.
- `ApiResponseInterceptor`: wraps successful responses as `{ code, data, msg }`.
- `ApiExceptionFilter`: wraps error responses as `{ code, data, msg, error }`.
- `AgentsService` maps between API DTOs and the config-file map structure.

## Routes

- `GET /agents`
- `GET /agents/:name`
- `POST /agents`
- `PUT /agents/:name`
- `DELETE /agents/:name`

## Validation

- `name`: non-empty string
- `model`: non-empty string
- `tools`: string array
- `description`: non-empty string
- `active`: `0` or `1`
- `systemPrompt`: non-empty string
- `PUT /agents/:name` supports renaming when `body.name` differs from the path name.

## File Handling

- The config path is resolved as `~/.imooc_claw/imooc_claw.json`.
- If the file does not exist, initialize it as `{ "agents": {} }`.
- If the file exists without `agents`, add `agents: {}`.
- Writes use a temp file plus rename for atomic replacement.

## Errors

- All responses use the same JSON shape:

```json
{
  "code": 0,
  "data": {},
  "msg": "success"
}
```

- Success: `code = 0`, `data = actual payload`, `msg = "success"`
- Error:

```json
{
  "code": 404,
  "data": null,
  "msg": "Agent \"missing\" does not exist.",
  "error": "AGENT_NOT_FOUND"
}
```

- Error: `code = HTTP status`, `data = null`, `msg = error message`, `error = machine-readable identifier`
- The filter first reads `error` from the exception response body if present; otherwise it maps from status code
- Agent-specific errors may return business identifiers such as `AGENT_NOT_FOUND`, `AGENT_ALREADY_EXISTS`, `INVALID_AGENT_NAME`, and `INVALID_AGENT_PAYLOAD`
- `400`: invalid agent name or invalid request body
- `404`: agent does not exist
- `409`: agent already exists
- `500`: invalid config file content or unexpected read/write failure

## Testing

- Unit tests for `AgentsService`
- Cover list, get, create, update, rename, delete, duplicate create, invalid payload, missing agent, and legacy field compatibility
