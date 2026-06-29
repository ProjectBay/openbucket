---
id: TEST-0416
title: AdminBootstrapService unit spec (three branches)
covers: [STORY-0412, TASK-1235]
status: done
level: unit
---

## Goal
Verify the three bootstrap branches: env hash provision, generate-temp-and-log, and no-op-when-exists.

## Setup
- Mocked `AdminUserRepository` (`findByUsername`, `insert`, `upsert`, `update`).
- Mocked `ConfigService.get` per case.
- Capture `Logger.warn` / `Logger.log` calls.

## Cases
1. `ADMIN_PASSWORD_HASH = '$argon2id$...'` → `upsert({ username: 'admin', passwordHash: '$argon2id$...', mustChangePassword: false })` is called once; no temp password logged.
2. No env, `findByUsername('admin')` returns null → `insert(...)` is called with `mustChangePassword: true`; `Logger.warn` is called with a string containing `TEMP-ADMIN-PASSWORD username=admin password=` and `change-on-first-login=true`.
3. No env, `findByUsername('admin')` returns an existing user → no repo writes, no warn log.
4. Temp password from case 2 is 24 chars (base64url over 18 random bytes).
5. The generated temp password is argon2id-hashed before insert (not stored plaintext).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=admin-bootstrap.service.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.8 (lines 7586–7649)
