# WebUI API Base URL Design

## Goal

Replace the hard-coded agents API base URL in `apps/webui` with an environment variable.

## Scope

- Add `API_BASE_URL` to `apps/webui/.env`
- Expose the value through Umi `define`
- Read the value in `agents-config/service.ts`
- Keep a local fallback of `http://localhost:3000`

## Notes

- Current default local value is `http://localhost:3000`
- This variable is intended to be reused by future models and tools API calls
- This step only updates the agents read API
