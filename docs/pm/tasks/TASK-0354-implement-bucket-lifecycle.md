---
id: TASK-0354
title: Implement bucket lifecycle (GET/PUT/DELETE ?lifecycle)
story: STORY-0114
status: done
type: implementation
size: S
---

## Description
Implement the three bucket lifecycle operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2523–2525):
  - `| GET  | `/:bucket` | `lifecycle` | `GetBucketLifecycleConfiguration` |`
  - `| PUT  | `/:bucket` | `lifecycle` | `PutBucketLifecycleConfiguration` |`
  - `| DELETE | `/:bucket` | `lifecycle` | `DeleteBucketLifecycle` |`
- `PutBucketLifecycleConfiguration` is in `XML_REQUEST_OPS` (§2.3.2 line 1372).
- Body: `<LifecycleConfiguration><Rule>…<Transition>…</Transition>…<NoncurrentVersionTransition>…</NoncurrentVersionTransition>…</Rule></LifecycleConfiguration>` (Rule, Transition, NoncurrentVersionTransition hinted as arrays per §2.3.3 lines 1487, 1495–1496).
- Apply `@S3Operation('GetBucketLifecycleConfiguration' | 'PutBucketLifecycleConfiguration' | 'DeleteBucketLifecycle')`.
- GET with no configuration → `NoSuchLifecycleConfigurationError`.

## Acceptance criteria
- [ ] PUT persists the document via `BucketService.setLifecycle(bucket, config)`.
- [ ] GET returns the persisted document or `NoSuchLifecycleConfiguration`.
- [ ] DELETE clears the configuration and returns 204.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0125]
- Conformance: covered by [TEST-0126]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2523–2525), §2.3.2 (line 1372), §2.3.3 (lines 1487, 1495–1496)
