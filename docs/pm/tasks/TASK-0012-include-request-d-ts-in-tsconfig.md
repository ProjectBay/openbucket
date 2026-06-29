---
id: TASK-0012
title: Reference request.d.ts in tsconfig.app.json
story: STORY-0005
status: done
type: infra
size: XS
---

## Description
Add `apps/backend/src/common/types/request.d.ts` to the backend's `tsconfig.app.json` `"types"` (or `"include"`) per §1.4 final paragraph so the augmentation propagates project-wide without explicit imports at use sites.

## Files to create / modify
- `apps/openbucket-backend/tsconfig.app.json` — modify

## Implementation notes
- §1.4 final paragraph (line 381) says verbatim: "This file is included via `tsconfig.app.json`'s `"types"` so the augmentation propagates through the backend without explicit imports at use sites."
- In practice, `.d.ts` files are usually picked up by `include` glob — if a `"types"` entry is needed for `tsc --noResolve`, add it; otherwise add the file to `include`.

## Acceptance criteria
- [ ] `nx build openbucket-backend` succeeds with no `Property 'openbucket' does not exist on type 'Request'` errors anywhere in the source.
- [ ] The augmentation is visible from `apps/openbucket-backend/src/admin/health/health.controller.ts` (STORY-0012) without an explicit import of `request.d.ts`.

## Test obligations
- Unit: covered by [TEST-0005]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0011]

## References
- `docs/WHITEPAPER.md` §1.4 (lines 380–382)
