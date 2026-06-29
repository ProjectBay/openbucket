---
id: STORY-0411
title: Implement access-key management endpoints
epic: EPIC-05
status: done
size: M
risk: medium
---

## User story
As an operator, I want to list, create, update (disable / relabel), and delete S3 access keys via the admin API, so that the SPA can manage credentials and the secret is surfaced exactly once at creation.

## Description
Build `apps/backend/src/admin/keys/keys-admin.controller.ts` per §5.7, mounted at `'api/admin/keys'`. Routes: `GET /` (list `KeySummaryDto[]`), `POST /` (HTTP 201, returns `CreatedKeyDto` with one-time `secretAccessKey`), `PATCH /:id` (update label and/or disabled), `DELETE /:id` (HTTP 204). All write paths emit audit events `key.created`, `key.updated` / `key.disabled`, `key.deleted` with `keyId` and `subject`. v1 hard-codes `role: 'root'` on create; response exposes the field so the SPA already renders it. `CreateKeyDto` and `UpdateKeyDto` are `.strict()` Zod DTOs; `UpdateKeyDto` `.refine`s that at least one of `label` / `disabled` is provided.

## Acceptance criteria
- [x] All four routes mounted at `'api/admin/keys'` under JWT.
- [x] `POST /` calls `KeyService.create({ label, role: 'root' })` and returns `CreatedKeyDto` containing `secretAccessKey` once. Subsequent reads never expose it.
- [x] `PATCH /:id` validates `UpdateKeyDto` (at least one field required, `.strict()`), calls `KeyService.update`, returns `KeySummaryDto` or 404; emits `key.disabled` when `dto.disabled === true`, otherwise `key.updated`.
- [x] `DELETE /:id` returns 204 and emits `key.deleted`.
- [x] DTOs `CreateKeyDto`, `UpdateKeyDto`, `KeySummaryDto`, `CreatedKeyDto` exist per §5.7.

## Tasks
- [TASK-1229] Author `CreateKeyDto`, `UpdateKeyDto`, `KeySummaryDto`, `CreatedKeyDto`
- [TASK-1230] Implement `KeysAdminController.list`
- [TASK-1231] Implement `KeysAdminController.create` returning secret once
- [TASK-1232] Implement `KeysAdminController.update` with conditional audit event
- [TASK-1233] Implement `KeysAdminController.delete`
- [TASK-1234] Wire `KeysAdminModule` and register controller

## Test plan
- [TEST-0414] KeysAdminController unit spec
- [TEST-0415] Access-key endpoints e2e (secret-once invariant)

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0400], [STORY-0407], [STORY-0413], [EPIC-03] (`KeyService`, `AccessKey` entity)

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7452–7585)
- Interfaces consumed: `KeyService.list / create / update / delete` (EPIC-03), `AuditService.emit` (STORY-0413)
- Interfaces produced: `KeysAdminController`, `KeysAdminModule`, `CreateKeyDto`, `UpdateKeyDto`, `KeySummaryDto`, `CreatedKeyDto`
