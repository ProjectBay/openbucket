---
id: TEST-0410
title: BucketsAdminController unit spec
covers: [STORY-0409, TASK-1219, TASK-1220, TASK-1221, TASK-1222, TASK-1223]
status: done
level: unit
---

## Goal
Verify the controller is a thin adapter over `BucketService` / `ObjectService` and that audit events are emitted on create/delete.

## Setup
- Instantiate the controller directly with mocked `BucketService`, `ObjectService`, `AuditService`.
- Provide a fake `req` with `user.username = 'admin'` and `requestId = 'req-1'`.

## Cases
1. `list` returns `{ buckets, total: items.length }` shape; createdAt is ISO-8601.
2. `create` calls `BucketService.create({ name, versioning, objectLock, region })`, emits `{ event: 'bucket.created', subject: 'admin', bucket, requestId: 'req-1' }`, returns `BucketSummaryDto` with `objectCount: 0, sizeBytes: 0`.
3. `get` returns 404 when `findByName` returns null; otherwise merges stats from `ObjectService.statsFor`.
4. `delete` calls `BucketService.deleteByName(name)` and emits `bucket.deleted` with `subject`, `bucket`, `requestId`.
5. `delete` does not swallow `BucketNotEmpty` — it propagates.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=buckets-admin.controller.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7250–7353)
