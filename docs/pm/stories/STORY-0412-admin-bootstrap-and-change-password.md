---
id: STORY-0412
title: Initial admin bootstrap and change-password flow
epic: EPIC-05
status: done
size: M
risk: medium
---

## User story
As an operator, I want the first run of the container to provision an admin user (either from `ADMIN_PASSWORD_HASH` or a generated temporary password logged to stdout) and force a password change on first login, so that there is no default credential to abuse.

## Description
Build `AdminBootstrapService` per §5.8, running in `OnApplicationBootstrap` with three branches:
1. `ADMIN_PASSWORD_HASH` set → `upsert({ username: 'admin', passwordHash: envHash, mustChangePassword: false })`.
2. No env, no existing user → generate 24-char base64url temp password, argon2id-hash it, insert with `mustChangePassword: true`, log `TEMP-ADMIN-PASSWORD username=admin password=<plain> change-on-first-login=true` exactly once at `warn` level.
3. Existing user, no env → no-op.

Also build `SettingsAdminController.changePassword` (`POST /api/admin/settings/change-password`, 204): verifies `currentPassword` via argon2, hashes new password, calls `AdminUserRepository.update({ passwordHash, mustChangePassword: false })`, emits `admin.password.changed` audit. Authoring `ChangePasswordDto` (current + new password, minimum length).

## Acceptance criteria
- [x] `AdminBootstrapService` implements `OnApplicationBootstrap` and dispatches the three branches in order.
- [x] Temp password is 18 random bytes encoded as base64url (24 chars).
- [x] The TEMP-ADMIN-PASSWORD log line is emitted at most once per fresh install and contains the literal grep handle `TEMP-ADMIN-PASSWORD`.
- [x] `POST /api/admin/settings/change-password` returns 204 on success; 401 (`'current password incorrect'`) on wrong current password; 401 if user row missing.
- [x] On success, the user row is updated with the new argon2id hash and `mustChangePassword: false`.
- [x] Audit event `admin.password.changed` is emitted with `subject` and `requestId`.

## Tasks
- [TASK-1235] Implement `AdminBootstrapService.onApplicationBootstrap`
- [TASK-1236] Author `ChangePasswordDto`
- [TASK-1237] Implement `SettingsAdminController.changePassword`
- [TASK-1238] Wire `SettingsAdminModule` and register controller

## Test plan
- [TEST-0416] AdminBootstrapService unit spec (three branches)
- [TEST-0417] Change-password endpoint e2e

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0400], [STORY-0407], [STORY-0413], [EPIC-01] (`ConfigService`), [EPIC-03] (`AdminUserRepository`)

## References
- `docs/WHITEPAPER.md` §5.8 (lines 7586–7698)
- Interfaces consumed: `AdminUserRepository` (EPIC-03), `ConfigService.get('ADMIN_PASSWORD_HASH')` (EPIC-01)
- Interfaces produced: `AdminBootstrapService`, `SettingsAdminController`, `SettingsAdminModule`, `ChangePasswordDto`
