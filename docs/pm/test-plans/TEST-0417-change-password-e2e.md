---
id: TEST-0417
title: Change-password endpoint e2e
covers: [STORY-0412, TASK-1237, TASK-1238]
status: done
level: e2e
---

## Goal
End-to-end verification of `POST /api/admin/settings/change-password` including the `mustChangePassword` clearance.

## Setup
- Boot backend with SQLite. Bootstrap an admin via the temp-password branch (case 2 of §5.8). Login with the temp password.

## Cases
1. POST with `{ currentPassword: <temp>, newPassword: 'long-enough-secret' }` and bearer → 204. Subsequent `/me` returns `mustChangePassword: false`.
2. POST with wrong current password → 401 `'current password incorrect'`.
3. POST with `newPassword: 'short'` → 400 `ValidationFailed` (minLen 12). (Corrected from 422: WHITEPAPER §1.6.2 / AdminExceptionFilter render Zod errors as 400.)
4. POST without bearer → 401.
5. After successful change, login with **old** temp password → 401; login with **new** password → 200.
6. Audit line emitted with `"event":"admin.password.changed"`, `"subject":"admin"`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=change-password.e2e-spec.ts`

## Pass criteria
- [x] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.8 (lines 7651–7695), §5.9 (line 7732)
