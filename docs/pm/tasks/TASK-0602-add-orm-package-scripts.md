---
id: TASK-0602
title: Add `orm:*` package scripts for migration CLI
story: STORY-0200
status: done
type: infra
size: XS
---

## Description
Add the four `orm:*` package scripts in `apps/openbucket-backend/package.json` so migrations can be created, applied, listed, and the schema reset from CLI without bespoke commands.

## Files to create / modify
- `apps/openbucket-backend/package.json` — modify (add scripts)

## Implementation notes
- Scripts (verbatim from §3.1.3):
  - `"orm": "mikro-orm --config=src/mikro-orm.config.ts"`
  - `"orm:migration:create": "npm run orm -- migration:create"`
  - `"orm:migration:up": "npm run orm -- migration:up"`
  - `"orm:migration:list": "npm run orm -- migration:list"`
  - `"orm:schema:fresh": "npm run orm -- schema:fresh"`
- Migrations are forward-only — no `orm:migration:down` script.

## Acceptance criteria
- [ ] `npm run -w apps/openbucket-backend orm:migration:list` (or equivalent for the Nx layout) runs and prints the migration list.
- [ ] `npm run -w apps/openbucket-backend orm` with no extra args prints the `mikro-orm` CLI help text.

## Test obligations
- Unit: N/A — pure infra
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0600]

## References
- `docs/WHITEPAPER.md` §3.1.3 (lines 3021–3046)
