---
id: TEST-0413
title: Admin object browser endpoints e2e
covers: [STORY-0410, TASK-1225, TASK-1226, TASK-1227]
status: done
level: e2e
---

## Goal
End-to-end verification of object listing, meta, and delete with real SQLite and JWT.

## Setup
- Boot backend. Login. Create bucket `b1`.
- Pre-seed three objects in `b1`: `a.txt`, `folder/b.txt`, `folder/sub/c.txt`.

## Cases
1. `GET /api/admin/buckets/b1/objects` → 200 with three objects in `contents`, empty `commonPrefixes`.
2. `GET /api/admin/buckets/b1/objects?delimiter=/` → `commonPrefixes: ['folder/']` and `contents` includes `a.txt` only.
3. `GET /api/admin/buckets/b1/objects?prefix=folder/&delimiter=/` → `commonPrefixes: ['folder/sub/']`, `contents` includes `folder/b.txt`.
4. `GET /api/admin/buckets/b1/objects?limit=1` → 200 with `isTruncated: true` and a non-empty `nextMarker`.
5. `GET /api/admin/buckets/b1/objects/folder%2Fb.txt/meta` → 200 with `key: 'folder/b.txt'`.
6. `DELETE /api/admin/buckets/b1/objects/folder%2Fb.txt` → 204; subsequent meta call → 404.
7. Audit log line emitted for `object.deleted` with `key: 'folder/b.txt'` (decoded).
8. Without bearer, all routes return 401.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=objects-admin.e2e-spec.ts`

## Pass criteria
- [ ] All eight cases pass.

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7354–7451)
