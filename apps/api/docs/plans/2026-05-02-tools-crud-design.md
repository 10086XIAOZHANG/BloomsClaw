# Tools CRUD Design

## Goal

Provide CRUD APIs for the `tools` key in `~/.blooms_claw/blooms_claw.json`.

## Data Model

The config file keeps `tools` as a map keyed by tool `name`.

```json
{
  "tools": {
    "WebSearch": {
      "description": "联网搜索工具",
      "active": 1,
      "builtin": 1
    }
  }
}
```

## API DTO

```json
{
  "name": "WebSearch",
  "description": "联网搜索工具",
  "active": 1,
  "builtin": 1
}
```

## Routes

- `GET /tools`
- `GET /tools/:name`
- `POST /tools`
- `PUT /tools/:name`
- `DELETE /tools/:name`

## Validation

- `name`: non-empty string and unique identifier
- `description`: non-empty string
- `active`: `0` or `1`
- `builtin`: `0` or `1`
- `PUT /tools/:name` supports renaming `name` while keeping the original position

## Errors

- `TOOL_NOT_FOUND`
- `TOOL_ALREADY_EXISTS`
- `INVALID_TOOL_NAME`
- `INVALID_TOOL_PAYLOAD`

## Testing

- Unit tests cover list, get, create, update, rename, order stability, delete, duplicate create, invalid payload, and legacy boolean compatibility
- E2E covers missing tool response shape
