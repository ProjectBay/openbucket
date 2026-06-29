---
id: TASK-1241
title: Scaffold frontend directory tree with placeholder files
story: STORY-0414
status: done
type: infra
size: S
---

## Description
Lay out the Angular SPA directory tree from §5.10 with empty placeholder files so subsequent Stories drop in components.

## Files to create / modify
- `apps/frontend/src/app/app.component.ts` — new (placeholder standalone shell)
- `apps/frontend/src/app/app.routes.ts` — new (export empty `routes: Routes`)
- `apps/frontend/src/app/auth/` — new directory with `.gitkeep`
- `apps/frontend/src/app/buckets/` — new directory with `.gitkeep`
- `apps/frontend/src/app/objects/` — new directory with `.gitkeep`
- `apps/frontend/src/app/keys/` — new directory with `.gitkeep`
- `apps/frontend/src/app/settings/` — new directory with `.gitkeep`
- `apps/frontend/src/app/shared/layout/` — new
- `apps/frontend/src/app/shared/ui/` — new
- `apps/frontend/src/app/shared/api/` — new

## Implementation notes
- Directory tree per §5.10 (lines 7749–7789):
  ```
  apps/frontend/src/app/
    app.config.ts, app.routes.ts, app.component.ts
    auth/ buckets/ objects/ keys/ settings/
    shared/ { layout/, ui/, api/ }
    main.ts
  ```
- Every component file added later must be `standalone: true` (§5.10).

## Acceptance criteria
- [ ] All directories from §5.10 exist.
- [ ] `app.component.ts` is a `standalone: true` empty shell exporting `AppComponent`.
- [ ] `nx build frontend` succeeds.

## Test obligations
- Unit: covered by [TEST-0419]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §5.10 (lines 7747–7791)
