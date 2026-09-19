# Models CRUD Design

## Goal

Provide CRUD APIs for the `models` key in `~/.blooms_claw/blooms_claw.json`.

## Data Model

The config file keeps `models` as a map keyed by model `name`.

```json
{
  "models": {
    "Qwen Plus": {
      "id": "model-qwen-plus",
      "name": "Qwen Plus",
      "provider": "qwen",
      "active": 1,
      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "api_key": "",
      "temperature": 0.7
    }
  }
}
```

## API DTO

```json
{
  "name": "Qwen Plus",
  "provider": "qwen",
  "active": 1,
  "id": "model-qwen-plus",
  "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "api_key": "",
  "temperature": 0.7
}
```

## Routes

- `GET /models`
- `GET /models/:name`
- `POST /models`
- `PUT /models/:name`
- `DELETE /models/:name`

## Validation

- `name`: non-empty string and unique identifier
- `provider`: non-empty string
- `active`: `0` or `1`
- `id`: non-empty string, used only as downstream model API identifier
- `base_url`: non-empty string
- `api_key`: string
- `temperature`: finite number
- `PUT /models/:name` supports renaming `name` while keeping the original position

## Errors

- `MODEL_NOT_FOUND`
- `MODEL_ALREADY_EXISTS`
- `INVALID_MODEL_NAME`
- `INVALID_MODEL_PAYLOAD`

## Testing

- Unit tests cover list, get, create, update, rename, order stability, delete, duplicate create, invalid payload, and legacy field compatibility
- E2E covers missing model response shape
