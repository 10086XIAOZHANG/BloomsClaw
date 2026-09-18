# Agent Update Order Design

## Goal

Keep an agent in its original position when updating or renaming it in `AgentsService.update()`.

## Approach

- Rebuild the `agents` object in the original entry order.
- When the current entry key matches the updated agent name, write the new key and new value at that same position.
- Keep all other entries unchanged.

## Scope

- Only change the update path in `apps/api/src/agents/agents.service.ts`
- Preserve rename support
- Add a focused unit test for multi-agent order stability
