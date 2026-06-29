---
id: STORY-0005
title: Augment Express.Request with OpenBucketRequestContext
epic: EPIC-01
status: done
size: XS
risk: low
---

## User story
As a developer, I want `req.openbucket` to be a strongly-typed field on `Express.Request` with a single `OpenBucketRequestContext` shape, so that classifier output, guards, controllers, and the logger consume typed fields rather than casting through `any`.

## Description
Create `apps/backend/src/common/types/request.d.ts` containing the module augmentation of `'express'` and the exported `OpenBucketRequestContext` interface with fields: `requestId: string`, `kind: 's3' | 'admin' | 'spa'`, `receivedAt: number`, optional `bucket`, `key`, `addressingStyle: 'virtual-host' | 'path'`, `s3Scope: 's3-service' | 's3-bucket' | 's3-object'`. Include this file in `tsconfig.app.json`'s `"types"` so augmentation propagates without explicit imports.

## Acceptance criteria
- [ ] `req.openbucket.requestId` is typed as `string` in any backend file with no imports needed.
- [ ] The interface fields and unions match §1.4 verbatim.
- [ ] `tsconfig.app.json`'s `types` array includes the augmentation file.
- [ ] `nx build openbucket-backend` succeeds with strict TypeScript.

## Tasks
- [TASK-0011] Author request.d.ts augmentation
- [TASK-0012] Reference request.d.ts in tsconfig.app.json

## Test plan
- [TEST-0005] Type augmentation surfaces typed req.openbucket (unit)

## Dependencies
- Blocks: [STORY-0006], [STORY-0007], [STORY-0008], [STORY-0009], [STORY-0010]
- Blocked by: [STORY-0001]

## References
- `docs/WHITEPAPER.md` §1.4 (lines 345–382)
- Interfaces produced: `OpenBucketRequestContext` (consumed by STORY-0006, STORY-0007, STORY-0009, STORY-0010, STORY-0014; consumed across Epics EPIC-02 (SigV4), EPIC-05 (admin auth))
