---
id: TEST-0412
title: ObjectsAdminController unit spec
covers: [STORY-0410, TASK-1225, TASK-1226, TASK-1227, TASK-1228]
status: done
level: unit
---

## Goal
Verify the object browser controller's pagination shape, single-decode of the key, and audit emission on delete.

## Setup
- Instantiate controller with mocked `ObjectService` and `AuditService`.

## Cases
1. `list` returns `{ bucket, prefix: '', delimiter, marker, nextMarker, isTruncated, contents, commonPrefixes }` shape.
2. `list` with omitted prefix yields response `prefix: ''` (not undefined).
3. `meta` calls `ObjectService.head(bucket, decodeURIComponent(key))` exactly once — key with `%2F` becomes `/`.
4. `meta` returns 404 when `head` returns null.
5. `delete` calls `ObjectService.delete(bucket, decoded)` and emits `{ event: 'object.deleted', subject, bucket, key: decoded, requestId }`.
6. A key encoded twice on the client (`%252F`) decodes to `%2F`, not `/` (single-decode invariant).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=objects-admin.controller.spec.ts`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7354–7451)
