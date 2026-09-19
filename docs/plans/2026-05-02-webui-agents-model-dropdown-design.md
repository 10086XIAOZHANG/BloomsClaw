# WebUI Agents Model Dropdown Design

## Goal

Load active models from backend `models` APIs into the Agents page model dropdown.

## Scope

- Reuse `getBloomsClawModelsConfig()`
- Load agents and models in parallel inside `agents/index.tsx`
- Only keep `enabled === true` models for dropdown options
- Leave tools loading unchanged for now
