---
id: STORY-0410
title: Implement admin object browser endpoints
epic: EPIC-05
status: done
size: M
risk: medium
---

## User story
As an operator, I want admin endpoints to list, head, and delete objects within a bucket, so that the SPA can implement a folder-style browser using prefix/delimiter pagination.

## Description
Build `apps/backend/src/admin/objects/objects-admin.controller.ts` per §5.6, mounted at `'api/admin/buckets/:name/objects'`. Routes: `GET /` (list with `ListObjectsQueryDto` — prefix/delimiter/marker/limit, returns `ListObjectsResponseDto` with `contents`, `commonPrefixes`, `nextMarker`, `isTruncated`), `GET /:key(*)/meta` (object metadata, with `decodeURIComponent` applied exactly once), `DELETE /:key(*)` (HTTP 204, emits `object.deleted` audit). The `:key(*)` wildcard captures slash-bearing keys; the SPA encodes once on the client side per §5.13.

## Acceptance criteria
- [x] All three routes mounted at `'api/admin/buckets/:name/objects'`.
- [x] `GET /` validates `ListObjectsQueryDto`, calls `ObjectService.list({ bucket, prefix, delimiter, marker, limit })`, returns `ListObjectsResponseDto` with fields `{ bucket, prefix, delimiter, marker, nextMarker, isTruncated, contents, commonPrefixes }`.
- [x] `GET /:key(*)/meta` decodes key exactly once (`decodeURIComponent`), returns `ObjectMetaDto` from `ObjectService.head(bucket, key)`, 404 on miss.
- [x] `DELETE /:key(*)` returns 204 and emits `object.deleted` audit with `subject`, `bucket`, `key` (decoded), `requestId`.
- [x] Key handling never double-decodes; literal slashes are preserved in stored key.

## Tasks
- [TASK-1224] Implement `ListObjectsResponseDto` and `ObjectMetaDto`
- [TASK-1225] Implement `ObjectsAdminController.list` with pagination
- [TASK-1226] Implement `ObjectsAdminController.meta` with one-time decode
- [TASK-1227] Implement `ObjectsAdminController.delete` with audit
- [TASK-1228] Wire `ObjectsAdminModule` and register controller

## Test plan
- [TEST-0412] ObjectsAdminController unit spec
- [TEST-0413] Admin object browser endpoints e2e

## Dependencies
- Blocks: [STORY-0418]
- Blocked by: [STORY-0400], [STORY-0407], [STORY-0408], [STORY-0413], [EPIC-03] (`ObjectService`)

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7354–7451)
- Interfaces consumed: `ObjectService.list / head / delete` (EPIC-03), `AuditService.emit` (STORY-0413)
- Interfaces produced: `ObjectsAdminController`, `ObjectsAdminModule`, `ListObjectsResponseDto`, `ObjectMetaDto`
