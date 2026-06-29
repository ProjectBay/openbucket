---
id: TEST-0411
title: Admin bucket endpoints e2e
covers: [STORY-0409, TASK-1219, TASK-1220, TASK-1221, TASK-1222]
status: backlog
level: e2e
---

## Goal
End-to-end verification of bucket admin endpoints against a real backend + SQLite + JWT.

## Setup
- Boot backend with in-memory SQLite. Seed admin. Login to obtain bearer.

## Cases
1. `POST /api/admin/buckets` body `{ name: 'foo' }` with bearer → 201 with `BucketSummaryDto { objectCount: 0, sizeBytes: 0 }`.
2. `POST /api/admin/buckets` body `{ name: 'BAD' }` → 422 (uppercase fails regex).
3. `POST /api/admin/buckets` without bearer → 401.
4. `POST /api/admin/buckets` body `{ name: 'foo', unknownField: true }` → 422 (`.strict()`).
5. `GET /api/admin/buckets` → 200 with `total: 1, buckets: [{ name: 'foo', ... }]`.
6. `GET /api/admin/buckets/missing` → 404 `bucket missing not found`.
7. `DELETE /api/admin/buckets/foo` on empty bucket → 204; subsequent GET returns 404.
8. `DELETE /api/admin/buckets/foo` on non-empty bucket → 409 `BucketNotEmpty` (mapped by exception filter).
9. OpenAPI document contains operationIds `listBuckets`, `createBucket`, `getBucket`, `deleteBucket`.
10. Audit lines emitted for `bucket.created` and `bucket.deleted` with `subject: 'admin'`, `bucket`, `requestId`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=buckets-admin.e2e-spec.ts`

## Pass criteria
- [ ] All ten cases pass.

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7250–7353), §5.13 (line 8159)
