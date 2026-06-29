---
id: STORY-0611
title: Access-keys management screen
epic: EPIC-07
status: done
size: M
risk: medium
---

## User story
As an admin, I want to list, create, enable/disable, relabel, and delete S3 access keys, and see a new secret exactly once, so I can manage credentials without the CLI.

## Description
`KeysAdminService` is fully implemented (list/create/update/delete) but the entire keys UI is placeholders: `keys-list.component.ts` is "Coming soon"; `keys.signal-store.ts`, `key-create-dialog.component.ts`, `key-secret-once-dialog.component.ts` are `export {}` stubs.

## Acceptance criteria
- [ ] `keys.signal-store.ts` implemented (mirrors `BucketsSignalStore`: items/loading/error + create/update/delete).
- [ ] `keys-list.component.ts` uses `HlmTable`: Label, Access Key ID (monospace + copy-button), Role (`hlmBadge`), Last used (`RelativeTimePipe` of `lastUsedAt`), Status (`hlm-switch` → `updateKey({disabled})`), row `HlmDropdownMenu` (Delete via confirm).
- [ ] Create flow uses `HlmDialog`; the secret is shown once via `key-secret-once-dialog` with a copy-button + "won't be shown again" warning.
- [ ] Loading/empty states (skeleton/`empty`); all mutations toast.

## Tasks
- [TASK-1853] Implement `keys.signal-store.ts` over `KeysAdminService`.
- [TASK-1854] Build `keys-list.component.ts` (`HlmTable` + badge + switch + dropdown + copy-button).
- [TASK-1855] Implement `key-create-dialog.component.ts` on `HlmDialog`.
- [TASK-1856] Implement `key-secret-once-dialog.component.ts` (copy + warning, focus the secret).
- [TASK-1857] Skeleton/empty states + toasts + keys i18n keys.

## Test plan
- [TEST-0611] Unit (keys store) + e2e/manual: create key → secret shown once + copyable; toggle disable; relabel; delete via confirm; last-used renders.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (power-user C/F6; IA F3; design).
- `apps/openbucket-frontend/src/app/keys/**`, `libs/api-client/src/lib/api/keys-admin.service.ts`, `libs/ui/spartan/{table,dialog,switch,badge,dropdown-menu,skeleton,empty}`.
