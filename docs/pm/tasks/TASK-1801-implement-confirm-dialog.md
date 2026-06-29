---
id: TASK-1801
title: Implement the shared confirm/alert dialog on spartan alert-dialog
story: STORY-0600
status: done
type: implementation
size: M
---

## Description
Replace the `confirm-dialog.component.ts` stub (`export {};`) with a reusable, accessible confirmation dialog built on the spartan `alert-dialog` primitives, openable programmatically and resolving a boolean. Supports a `destructive` style and an optional "type-to-confirm" guard (for bucket deletes). Focus-trap/restore/Escape come from CDK via the brain dialog.

## Files to create / modify
- `apps/openbucket-frontend/src/app/shared/ui/confirm-dialog.component.ts` — replace stub

## Implementation notes
- Import `HlmAlertDialogImports` from `@openbucket/spartan-ui/alert-dialog` (`HlmAlertDialog, HlmAlertDialogContent, HlmAlertDialogHeader, HlmAlertDialogTitle, HlmAlertDialogDescription, HlmAlertDialogFooter, HlmAlertDialogAction, HlmAlertDialogCancel, HlmAlertDialogOverlay`).
- `HlmAlertDialog` is `exportAs: 'hlmAlertDialog'` and `extends BrnAlertDialog` (→ `BrnDialog`), which exposes programmatic `open()` / `close()`. Drive it via a `@ViewChild(HlmAlertDialog)` (or template ref) so the component exposes:
  - inputs: `title`, `description`, `confirmLabel='Confirm'`, `cancelLabel='Cancel'`, `destructive=false`, `confirmPhrase?` (type-to-confirm).
  - a method `confirm(): Promise<boolean>` that opens the dialog and resolves true on Action, false on Cancel/Escape/overlay.
- Action button uses `hlmBtn` with `variant="destructive"` when `destructive`; a leading `lucideTriangleAlert` icon in the header for destructive confirms.
- When `confirmPhrase` is set, render an `hlm-input`; the Action is disabled until the typed value `=== confirmPhrase`.
- Do NOT re-implement focus trap/scroll-lock/Escape — they are provided by `BrnDialog`/CDK.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (a11y rules included).
- [ ] `confirm()` resolves `true` only after Action (and, when `confirmPhrase` set, only once the input matches); resolves `false` on Cancel/Escape.
- [ ] Opening moves focus into the dialog and restores it to the trigger on close (CDK).
- [ ] Destructive mode renders a `variant="destructive"` action + warning icon.

## Test obligations
- Unit: covered by [TEST-0600] (resolve-true gating, type-to-confirm disable).
- E2E: exercised indirectly by STORY-0603/0604 delete flows.
- Conformance: N/A.

## Dependencies
- Blocked by: _none_

## References
- UX review 2026-06-22 (interaction F2, a11y A11Y-1 — destructive confirms + focus management).
- `libs/ui/spartan/alert-dialog/src/index.ts` (`HlmAlertDialogImports`), `.../lib/hlm-alert-dialog.ts` (`extends BrnAlertDialog`), `libs/ui/spartan/{button,input}`.
- Interfaces produced: `ConfirmDialogComponent` (consumed by STORY-0603/0604/0611).
