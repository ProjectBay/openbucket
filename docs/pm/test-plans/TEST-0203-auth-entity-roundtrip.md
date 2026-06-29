---
id: TEST-0203
title: Auth entity persistence round-trip (AccessKey, AdminUser, RefreshToken)
covers: [STORY-0203, TASK-0609, TASK-0610, TASK-0611]
status: done
level: unit
---

## Goal
Verify all three auth-side entities persist with their defaults, indexes are present, and the `RefreshToken.rotatedFrom` chain pointer works.

## Setup
- Real `:memory:` SQLite; initial migration applied at suite setup.

## Cases
1. Given a fresh `AccessKey { accessKeyId: 'AKIA', secretHash: '<hash>' }`, the read-back has `label === ''`, `disabled === false`, and `createdAt` populated.
2. Given an `AdminUser { username: 'root', passwordHash: '<hash>' }`, the row persists with PK `'root'`; a second insert with the same `username` rejects.
3. Given `RefreshToken { id: 'r1', tokenHash: '<sha>', subject: 'admin', issuedAt: now, expiresAt: now + 7d }`, the row persists; reading back via `em.findOne` returns matching fields.
4. Given a chain `r1` → `r2` (where `r2.rotatedFrom = 'r1'`), the `rotatedFrom` field is preserved on read.
5. Given `select name from sqlite_master where type='index' and name like 'ix_refresh_%'`, both `ix_refresh_subject` and `ix_refresh_expires` are present.

## Tooling
- Framework: jest
- Runner: `nx test persistence --testPathPattern=auth-entities.spec.ts`

## Pass criteria
- [x] All five cases pass (`libs/persistence/src/auth-entities.spec.ts`).
- [x] No plaintext secret/password column on `access_keys`/`admin_users` — only `secret_hash`/`password_hash` (asserted via `PRAGMA table_info`).

## Realization note
Schema built via `orm.schema.createSchema()` (initial migration is STORY-0205).
Duplicate-PK rejection (case 2) uses two EM forks so both attempt a real INSERT.

## References
- `docs/WHITEPAPER.md` §3.2.6 (lines 3366–3393), §3.2.7 (lines 3395–3414), §3.2.8 (lines 3416–3447)
