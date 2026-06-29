---
id: TASK-1854
title: Build keys-list.component.ts (HlmTable + badge + switch + dropdown + copy-button)
story: STORY-0611
status: done
type: implementation
size: L
---

## Description
Replace the `keys-list.component.ts` "Coming soon" placeholder with the real access-keys table on the design system. Columns: Label, Access Key ID (monospace + copy-button), Role (`hlmBadge`), Last used (relative time), Status (`hlm-switch` toggling enabled/disabled), and a per-row actions menu (`HlmDropdownMenu`) with a Delete item that goes through the shared confirm dialog.

## Files to create / modify
- `apps/openbucket-frontend/src/app/keys/keys-list.component.ts` — replace placeholder (keep selector `ob-keys-list`, standalone, OnPush)

## Implementation notes
- Inject `KeysSignalStore` (TASK-1853); call `refresh()` on init. Iterate `store.items()` (`KeySummaryDto[]`).
- Table: import `HlmTableImports` from `@openbucket/spartan-ui/table` (`HlmTable`/`HlmTHead`/`HlmTBody`/`HlmTr`/`HlmTh`/`HlmTd`, etc.). Columns:
  - Label → `key.label`.
  - Access Key ID → `key.accessKeyId` in a monospace span + `<ob-copy-button [value]="key.accessKeyId" />` (the `CopyButtonComponent` from `shared/ui/copy-button.component`, STORY-0600).
  - Role → `<span hlmBadge [variant]="…">{{ key.role }}</span>` (`HlmBadge` from `@openbucket/spartan-ui/badge`, `variant` input `default|secondary|destructive|outline`).
  - Last used → `{{ key.lastUsedAt | relativeTime }}` (`RelativeTimePipe`, pipe `relativeTime`); render a dash when `lastUsedAt === null`.
  - Status → `<hlm-switch [checked]="!key.disabled" (checkedChange)="onToggle(key, $event)" />` (`HlmSwitch` from `@openbucket/spartan-ui/switch`; it has `checked` model + `checkedChange` output + `disabled` input + aria inputs). `onToggle` calls `store.update(key.id, { disabled: !$event })` then toasts via `notify`.
  - Actions → a `[hlmDropdownMenu]` trigger button with a Delete `hlmDropdownMenuItem` (destructive styling) wired to the delete flow in TASK-1856's sibling task... (delete itself is wired in this task via the confirm dialog — see below).
- Delete: open the shared `ConfirmDialogComponent` (`shared/ui/confirm-dialog.component`, STORY-0600) in `destructive` mode with `confirmPhrase` = the key's label (type-to-confirm); on confirm call `store.remove(key.id)` then `notify.success(...)`.
- Give the `hlm-switch` an accessible name (`ariaLabel` input, e.g. "Enable/disable {{label}}"); the copy-button already carries its own `aria-label`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The keys table renders via `HlmTableImports` with all six columns; Access Key ID is monospace with a working copy-button; Role is an `hlmBadge`; Last used uses `relativeTime` (dash when null).
- [ ] Toggling the Status `hlm-switch` calls `store.update(id, { disabled })` and toasts; the row reflects the new state.
- [ ] The row dropdown's Delete opens the shared confirm (type-to-confirm) → `store.remove(id)` → toast → row removed.

## Test obligations
- Unit: covered by [TEST-0611] (toggle calls update; delete calls remove after confirm).
- E2E: covered by [TEST-0611] (toggle/relabel/delete; last-used renders).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1853], [STORY-0600]

## References
- UX review 2026-06-22 (power-user C/F6; IA F3; design — keys list placeholder).
- `apps/openbucket-frontend/src/app/keys/keys-list.component.ts`, `keys.signal-store.ts`, `libs/api-client` (`KeySummaryDto` `{id,accessKeyId,label,role,createdAt,lastUsedAt,disabled}`), `libs/ui/spartan/{table,badge,switch,dropdown-menu}`, `shared/ui/{copy-button.component.ts,confirm-dialog.component.ts,relative-time.pipe.ts,notify.ts}` (STORY-0600).
- Interfaces consumed: `KeysSignalStore`, `CopyButtonComponent`, `ConfirmDialogComponent`, `notify`, `RelativeTimePipe`.
