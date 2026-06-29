---
id: TASK-1815
title: Implement bucket-create-dialog on HlmDialog with inline name validation
story: STORY-0603
status: done
type: implementation
size: M
---

## Description
Delete the hand-rolled `position:fixed` modal in `bucket-list.component.ts:58-113` and implement the empty `bucket-create-dialog.component.ts` stub (`export {}`) as a real `HlmDialog`-based create form. The dialog gets a name field (`hlm-input`), a versioning toggle (`hlm-switch`), inline S3-name validation, and a busy state — gaining focus-trap, focus-restore, and Escape-to-close for free from the design-system dialog. `bucket-list.component.ts` opens it imperatively via `HlmDialogService.open(...)`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-create-dialog.component.ts` — implement (currently `export {}`)
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (remove the `@if (showCreate())` modal block + `onBackdrop`/`showCreate`; open via `HlmDialogService`)

## Implementation notes
- Build the dialog content as a standalone component using `HlmDialogImports` from `@openbucket/spartan-ui/dialog` (`HlmDialog`, `HlmDialogContent`, `HlmDialogHeader`, `HlmDialogTitle`, `HlmDialogDescription`, `HlmDialogFooter`, `HlmDialogClose`, ...). Open it from `bucket-list.component.ts` with `HlmDialogService.open(BucketCreateDialogComponent, { context: {...} })` (`open(component, options?)` returns a dialog ref) — `@openbucket/spartan-ui/dialog` exports `HlmDialogService` and `HlmDialogOptions`.
- Name field: `hlm-input` (`HlmInputImports` / `HlmInput`, `selector` `input[hlmInput]`) bound with `FormsModule` `[(ngModel)]`. Versioning: `HlmSwitchImports` (`HlmSwitch`, `HlmSwitchThumb`) from `@openbucket/spartan-ui/switch` replacing the raw `<input type="checkbox">`.
- Inline validation against the S3 bucket-name rule (3–63 chars; lowercase letters, digits, `.` and `-`; the existing helper text at `:83` documents it). Disable the Action button while the name is empty/invalid or `creating()` is true; show the rule violation inline (replacing the old `createError()` paragraph + the `messageFor()` 400/409/0 mapping, which moves with the submit handler).
- On submit, call `BucketsSignalStore.create(dto)` with `dto: CreateBucketDto = { name, versioning: enabled ? CreateBucketDtoVersioningEnum.Enabled : CreateBucketDtoVersioningEnum.Disabled }` (`CreateBucketDtoVersioningEnum` from `@openbucket/api-client`). Close the dialog ref on success; keep the busy/`creating` signal so the footer shows "Creating…".
- The hand-rolled modal (the `class="fixed inset-0 z-50 ... bg-black/40"` block, `aria-modal="true"` `role="dialog"`, `onBackdrop`, `showCreate`) MUST be removed — focus-trap/restore/Escape now come from `HlmDialog`/brain.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `bucket-create-dialog.component.ts` no longer contains `export {}`; it exports a standalone `BucketCreateDialogComponent` built on `HlmDialogImports`.
- [ ] No `class="fixed inset-0"` modal and no `onBackdrop`/`showCreate` remain in `bucket-list.component.ts`.
- [ ] Entering an invalid name (e.g. `AB` or `My_Bucket`) keeps the Action button disabled with inline feedback; a valid name submits and the dialog closes.
- [ ] Opening the dialog moves focus into it and closes on Escape (verified manually).

## Test obligations
- Unit: covered by [TEST-0603] (validation predicate enables/disables Action; store.create called with the right `versioning` enum).
- E2E: covered by [TEST-0603] (manual — focus trap/restore, Escape, validation).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1814]

## References
- UX review 2026-06-22 (interaction lens B create-flow; a11y lens A11Y-1 focus management).
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts:58-113`, `bucket-create-dialog.component.ts`, `libs/ui/spartan/dialog` (`HlmDialogImports`, `HlmDialogService`), `libs/ui/spartan/{input,switch}`, `@openbucket/api-client` (`CreateBucketDto`, `CreateBucketDtoVersioningEnum`).
