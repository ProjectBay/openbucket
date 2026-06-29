---
id: TASK-1855
title: Implement key-create-dialog.component.ts on HlmDialog
story: STORY-0611
status: done
type: implementation
size: M
---

## Description
Replace the `key-create-dialog.component.ts` stub (`export {};`) with a real create-access-key dialog on the spartan dialog primitives. It collects a label, calls `KeysSignalStore.create`, and on success hands the returned `CreatedKeyDto` (which carries the one-time secret) to the secret-once dialog (TASK-1856).

## Files to create / modify
- `apps/openbucket-frontend/src/app/keys/key-create-dialog.component.ts` — replace stub (standalone, OnPush)

## Implementation notes
- Build the dialog content on `HlmDialogImports` from `@openbucket/spartan-ui/dialog` (`HlmDialog`/`HlmDialogContent`/`HlmDialogHeader`/`HlmDialogTitle`/`HlmDialogDescription`/`HlmDialogFooter`/`HlmDialogClose`). The dialog is opened programmatically via `HlmDialogService.open(component, { context })` (`@openbucket/spartan-ui/dialog`) from the keys-list "Create key" button — focus-trap/restore/Escape come from the CDK brain dialog for free.
- Field: a single label input — `[hlmField]` + `[hlmLabel]` + `input hlmInput` (`@openbucket/spartan-ui/{field,label,input}`) bound with `[(ngModel)]` (`FormsModule`); trim and require a non-empty label. The create contract is `CreateKeyDto { label }`.
- Submit (`hlmBtn`): disable while busy / empty label; call `await store.create({ label })` (TASK-1853), which returns the full `CreatedKeyDto` (`{ id, accessKeyId, secretAccessKey, label, role, createdAt }`). On success: close this dialog, then open `key-secret-once-dialog` (TASK-1856) passing the `CreatedKeyDto`, and `notify.success('Access key created')`. On failure: `notify.error(...)` and keep the dialog open.
- Do not display the secret in this dialog — the secret is shown exactly once in the dedicated secret-once dialog.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] "Create key" opens an `HlmDialog` with a label field; submit is disabled until a non-empty label is entered.
- [ ] Submitting calls `KeysSignalStore.create({ label })`, closes this dialog, opens the secret-once dialog with the returned `CreatedKeyDto`, and toasts success; the new key appears in the list.
- [ ] Focus is trapped in the dialog and restored to the trigger on close (CDK).

## Test obligations
- Unit: N/A (covered behaviorally).
- E2E: covered by [TEST-0611] (create → secret shown once).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1853], [STORY-0600]

## References
- UX review 2026-06-22 (power-user C/F6 — no create-key flow).
- `apps/openbucket-frontend/src/app/keys/key-create-dialog.component.ts`, `keys.signal-store.ts`, `libs/api-client` (`CreateKeyDto`/`CreatedKeyDto`), `libs/ui/spartan/dialog` (`HlmDialogImports`, `HlmDialogService.open`), `libs/ui/spartan/{field,label,input,button}`, `shared/ui/notify.ts`.
- Interfaces consumed: `KeysSignalStore`, `notify`, `key-secret-once-dialog` (TASK-1856).
- Interfaces produced: `KeyCreateDialogComponent`.
