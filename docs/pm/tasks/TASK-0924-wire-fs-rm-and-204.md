---
id: TASK-0924
title: Wire fs/promises.rm and 204 response on abort
story: STORY-0308
status: done
type: implementation
size: XS
---

## Description
Verify the import surface (`import { rm } from 'node:fs/promises'`) and the `@HttpCode(204)` decorator on the abort handler. The 204 response carries no body.

## Files to create / modify
- `apps/backend/src/s3/multipart/abort-multipart.handler.ts` — modify

## Implementation notes
- `import { rm } from 'node:fs/promises'`.
- `@HttpCode(204)` per §4.4.4.

## Acceptance criteria
- [ ] Source imports `rm` from `node:fs/promises`.
- [ ] `@HttpCode(204)` is present on the handler method.

## Test obligations
- Unit: covered by [TEST-0313]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0923]

## References
- `docs/WHITEPAPER.md` §4.4.4 (lines 5994–6014)
