---
id: TASK-1246
title: Scaffold LoginComponent, ForceRotateComponent, ShellComponent stubs
story: STORY-0415
status: done
type: implementation
size: XS
---

## Description
Add minimal standalone-component stubs so the lazy-load imports in `app.routes.ts` resolve. Full UI is out of scope for this Story.

## Files to create / modify
- `apps/frontend/src/app/auth/login.component.ts` — new
- `apps/frontend/src/app/auth/force-rotate.component.ts` — new
- `apps/frontend/src/app/shared/layout/shell.component.ts` — new (includes `<router-outlet />` for child routes)
- `apps/frontend/src/app/buckets/bucket-list.component.ts` — new (placeholder; real impl in STORY-0417)
- `apps/frontend/src/app/buckets/bucket-detail.component.ts` — new (placeholder)
- `apps/frontend/src/app/keys/keys-list.component.ts` — new (placeholder)
- `apps/frontend/src/app/settings/settings.component.ts` — new (placeholder)

## Implementation notes
- Every component is `standalone: true` with `selector: 'ob-...'`.
- `ShellComponent` template must include `<router-outlet />` so children render.
- Other placeholders can render a simple `<h1>` for now.

## Acceptance criteria
- [ ] All listed components exist as standalone components.
- [ ] `ShellComponent` template hosts `<router-outlet />`.
- [ ] `nx build frontend` succeeds.

## Test obligations
- Unit: covered by [TEST-0419]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1241]

## References
- `docs/WHITEPAPER.md` §5.10 (lines 7747–7791)
