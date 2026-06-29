---
id: STORY-0600
title: Shared UX kit — toasts, confirm dialog, copy-button, live-region announcer
epic: EPIC-07
status: done
size: M
risk: low
---

## User story
As an admin, I want consistent success/error feedback, one confirmation dialog for destructive actions, one-click copy with feedback, and screen-reader announcements, so that every screen behaves the same and I always know the outcome of an action.

## Description
Build the small set of shared primitives the rest of EPIC-07 reuses. The sonner toaster is already mounted (`app.component.html:2`) but `toast()` is never called anywhere; `shared/ui/confirm-dialog.component.ts` is an `export {}` stub; there is no copy-to-clipboard anywhere; and there is no `aria-live` region in the app. Land these once so feature stories consume them instead of re-rolling.

## Acceptance criteria
- [ ] A `notify` helper wraps `toast` (ngx-sonner) with `success`/`error`/`promise`; the existing `HlmToaster` stays mounted.
- [ ] `shared/ui/confirm-dialog.component.ts` is implemented on `HlmAlertDialogImports`, with title/description/confirm-label/`destructive` inputs, a busy state, and an optional "type-to-confirm" mode (for bucket deletes).
- [ ] A `copy-button` component copies to clipboard, fires a "Copied" toast, swaps its icon ~1.5s, and carries an `aria-label` + tooltip.
- [ ] A `StatusAnnouncer` (CDK `LiveAnnouncer` or a root `role="status"` region) is available app-wide for async status.
- [ ] sonner toasts are verified to announce via `aria-live` (or the announcer is called alongside them).

## Tasks
- [TASK-1800] Add `shared/ui/notify.ts` wrapping ngx-sonner `toast` (success/error/promise); keep `HlmToaster` in `app.component.ts`.
- [TASK-1801] Implement `shared/ui/confirm-dialog.component.ts` on `@openbucket/spartan-ui/alert-dialog` (title/description/confirm/cancel, `destructive` → `hlmBtn variant="destructive"`, busy state, type-to-confirm).
- [TASK-1802] Add `shared/ui/copy-button.component.ts` (`hlmBtn variant="ghost" size="icon-sm"` + `HlmTooltip` + lucide copy/check) firing the `notify` toast.
- [TASK-1803] Add a `StatusAnnouncer` service/region in `DynamicShellLayout`; verify sonner `aria-live`.

## Test plan
- [TEST-0600] Unit (jest): notify calls the underlying toast; confirm-dialog emits confirm only after type-to-confirm matches; copy-button writes clipboard + toasts. Manual a11y: announcer is read by a screen reader.

## Dependencies
- Blocks: [STORY-0603], [STORY-0604], [STORY-0606], [STORY-0607], [STORY-0611], [STORY-0616]
- Blocked by: _none_

## References
- UX review 2026-06-22 (interaction lens F1/F2/F7; a11y lens A11Y-3).
- `apps/openbucket-frontend/src/app/app.component.{ts,html}`, `shared/ui/confirm-dialog.component.ts`, `libs/ui/spartan/{sonner,alert-dialog,tooltip,button}`.
- Interfaces produced: `notify`, `ConfirmDialogComponent`, `CopyButtonComponent`, `StatusAnnouncer`.
