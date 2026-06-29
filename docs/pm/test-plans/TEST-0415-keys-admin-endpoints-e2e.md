---
id: TEST-0415
title: Access-key endpoints e2e (secret-once invariant)
covers: [STORY-0411, TASK-1231, TASK-1232, TASK-1233]
status: done
level: e2e
---

## Goal
End-to-end verification of key management endpoints including the security-critical "secret returned exactly once" invariant.

## Setup
- Boot backend with SQLite. Login as admin to obtain bearer.

## Cases
1. `POST /api/admin/keys` body `{ label: 'app-1' }` → 201 with `CreatedKeyDto` containing non-empty `secretAccessKey` and `role: 'root'`.
2. Subsequent `GET /api/admin/keys` returns the key in the list **without** `secretAccessKey`.
3. `PATCH /api/admin/keys/:id` with `{ disabled: true }` → 200 with `KeySummaryDto.disabled === true`; audit line shows `key.disabled`.
4. `PATCH /api/admin/keys/:id` with empty body → 422 `'at least one field required'`.
5. `PATCH /api/admin/keys/:id` with `{ label: 'renamed' }` → 200; audit line shows `key.updated`.
6. `DELETE /api/admin/keys/:id` → 204; subsequent list does not contain the key.
7. Without bearer, all routes → 401.
8. Backing DB inspection: `secretAccessKey` is never stored in plaintext (only hash/digest column).

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=keys-admin.e2e-spec.ts`

## Pass criteria
- [ ] All eight cases pass.

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7452–7585), §5.9 (lines 7737–7740)
