# WebUI Models Delete Key Design

## Goal

Make model deletion follow backend semantics and avoid relying on a missing `id` during editing.

## Root Cause

- Backend unique key is `name`
- Frontend `ModelItem.id` is only a persisted key mirror after loading from backend
- Newly created items start with empty `id`
- UI loading and delete logic used `id`, so some states could not resolve a stable key

## Fix

- Delete by `current.name`
- Use `current.name || current.id` as the page runtime key for loading and disabled states
