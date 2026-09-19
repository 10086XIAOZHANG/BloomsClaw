# WebUI Models API Design

## Goal

Connect the `models` page in `apps/webui` to the backend `models` CRUD APIs.

## Mapping

- Backend unique key is `name`
- Frontend `ModelItem.id` stores the persisted backend key for update and delete
- Backend `id` maps to frontend `model`
- Backend `active` maps to frontend `enabled`
- Backend `base_url` maps to frontend `baseUrl`
- Backend `api_key` maps to frontend `apiKey`

## Scope

- Add `getBloomsClawModelsConfig()` in `service.ts`
- Update `models/index.tsx` to load from backend
- Reuse backend APIs for save and delete
- Add delete confirmation dialog
