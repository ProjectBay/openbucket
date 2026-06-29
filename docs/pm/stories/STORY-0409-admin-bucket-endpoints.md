---
id: STORY-0409
title: Implement admin bucket endpoints
epic: EPIC-05
status: done
size: M
risk: low
---

## User story
As an operator, I want admin endpoints to list, create, inspect, and delete buckets, so that the SPA can manage buckets through the same domain services the S3 layer uses.

## Description
Build `apps/backend/src/admin/buckets/buckets-admin.controller.ts` per §5.5 with four routes mounted at `'api/admin/buckets'`: `GET /` (list with stats), `POST /` (HTTP 201, create), `GET /:name` (head with stats), `DELETE /:name` (HTTP 204). Controller is a thin adapter over `BucketService` and `ObjectService` — no business rules inline. Emits `bucket.created` and `bucket.deleted` audit events with `subject`, `bucket`, `requestId`.

## Acceptance criteria
- [x] All four routes are mounted under `'api/admin/buckets'` and protected by the global `JwtAuthGuard`.
- [x] `GET /` returns `ListBucketsResponseDto` shaped from `BucketService.listWithStats()`.
- [x] `POST /` validates `CreateBucketDto`, calls `BucketService.create({ name, versioning, objectLock, region })`, emits `bucket.created` audit, returns HTTP 201 with `BucketSummaryDto` (with `objectCount: 0, sizeBytes: 0`).
- [x] `GET /:name` returns `BucketSummaryDto` or 404 (`NotFoundException('bucket <name> not found')`).
- [x] `DELETE /:name` returns 204; `BucketService.deleteByName` may throw `BucketNotEmpty`; emits `bucket.deleted` audit.
- [x] No `@Public()` decoration anywhere on this controller.

## Tasks
- [TASK-1219] Implement `BucketsAdminController.list`
- [TASK-1220] Implement `BucketsAdminController.create` with audit
- [TASK-1221] Implement `BucketsAdminController.get`
- [TASK-1222] Implement `BucketsAdminController.delete` with audit
- [TASK-1223] Wire `BucketsAdminModule` and register controller

## Test plan
- [TEST-0410] BucketsAdminController unit spec
- [TEST-0411] Admin bucket endpoints e2e

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0400], [STORY-0407], [STORY-0408], [STORY-0413], [EPIC-03] (`BucketService`, `ObjectService` domain services)

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7250–7353)
- Interfaces consumed: `BucketService.listWithStats / create / findByName / deleteByName` (EPIC-03), `ObjectService.statsFor` (EPIC-03), `AuditService.emit` (STORY-0413)
- Interfaces produced: `BucketsAdminController`, `BucketsAdminModule`
