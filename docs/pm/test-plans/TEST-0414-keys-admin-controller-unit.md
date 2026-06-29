---
id: TEST-0414
title: KeysAdminController unit spec
covers: [STORY-0411, TASK-1230, TASK-1231, TASK-1232, TASK-1233, TASK-1234]
status: done
level: unit
---

## Goal
Verify list/create/update/delete behaviour and audit-event variants on `update`.

## Setup
- Instantiate controller with mocked `KeyService` and `AuditService`.

## Cases
1. `list` returns array of `KeySummaryDto` with `lastUsedAt` mapped to `null` when undefined and `role: 'root'`.
2. `create` calls `KeyService.create({ label, role: 'root' })`, emits `key.created`, returns `CreatedKeyDto` containing `secretAccessKey`.
3. `update({ disabled: true })` emits `key.disabled`; `update({ label: 'new' })` emits `key.updated`; `update({ disabled: false })` emits `key.updated`.
4. `update` returns 404 when `KeyService.update` returns null.
5. `delete` returns void; emits `key.deleted`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=keys-admin.controller.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7452–7585)
