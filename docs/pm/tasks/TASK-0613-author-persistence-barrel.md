---
id: TASK-0613
title: Author `libs/persistence/src/index.ts` barrel
story: STORY-0204
status: done
type: implementation
size: XS
---

## Description
Create the single `libs/persistence/src/index.ts` barrel that re-exports the shared types, all nine entity classes, and both custom repositories. This file is the public surface of the `@openbucket/persistence` library; the MikroORM config in TASK-0600 and PersistenceModule in TASK-0601 both import through it.

## Files to create / modify
- `libs/persistence/src/index.ts` — new

## Implementation notes
- Export order (verbatim from §3.2.10):
  - `export * from './entities/types';`
  - `export * from './entities/bucket.entity';`
  - `export * from './entities/object.entity';`
  - `export * from './entities/object-version.entity';`
  - `export * from './entities/multipart-upload.entity';`
  - `export * from './entities/multipart-part.entity';`
  - `export * from './entities/access-key.entity';`
  - `export * from './entities/admin-user.entity';`
  - `export * from './entities/refresh-token.entity';`
  - `export * from './entities/lifecycle-state.entity';`
  - `export * from './repositories/bucket.repository';`
  - `export * from './repositories/object.repository';`

## Acceptance criteria
- [ ] `import { Bucket, ObjectEntity, ObjectVersion, MultipartUpload, MultipartPart, AccessKey, AdminUser, RefreshToken, LifecycleState, BucketRepository, ObjectRepository } from '@openbucket/persistence';` resolves and type-checks.
- [ ] `nx build persistence` succeeds.

## Test obligations
- Unit: covered by [TEST-0204]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0604], [TASK-0605], [TASK-0606], [TASK-0607], [TASK-0608], [TASK-0609], [TASK-0610], [TASK-0611], [TASK-0612], [TASK-0616], [TASK-0617]

## References
- `docs/WHITEPAPER.md` §3.2.10 (lines 3474–3491)
