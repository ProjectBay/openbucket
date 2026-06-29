---
id: TASK-1891
title: Audit toast/confirm/empty-state/upload-summary strings for keys
story: STORY-0617
status: done
type: refactor
size: S
---

## Description
Audit the strings raised through the shared UX primitives (STORY-0600 consumers) — toasts, confirm-dialog title/description/labels, empty states, and the upload summary — and route them through translation keys so feedback and dialogs translate too, not just static screen chrome.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add a `common` group: toasts, confirm labels, empty states)
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` — modify (upload-summary strings → keys)
- Call sites of `notify.*`, `ConfirmDialogComponent`, and empty states across `buckets`/`objects`/`keys` — modify (pass translated strings)

## Implementation notes
- `notify` (TASK-1800) takes a `message: string`; callers must pass an already-translated string (e.g. `notify.success(translate.instant('common.toasts.deleted'))`) since `notify` itself is framework-thin and not DI-aware. Audit every `notify.success`/`error`/`promise` call introduced by STORY-0604/0606/0611/0614/0615 and replace literals with keys.
- `ConfirmDialogComponent` (TASK-1801) inputs `title`/`description`/`confirmLabel`/`cancelLabel`/`confirmPhrase`: pass translated values from the caller; default labels ("Confirm"/"Cancel") should resolve from `common.confirm.*` keys.
- Empty states (e.g. "No buckets yet.", "This prefix is empty.", versions/tags empty from TASK-1877) get `common.empty.*` keys where shared, or screen-specific keys where unique.
- Upload summary (`object-upload.component.ts`): the per-file/aggregate progress and result strings (e.g. "Uploaded N files", failures) go through keys with parameterized counts (`translate.instant('common.upload.summary', { count })`).
- Add a reusable `common` group so the same toast/confirm strings aren't duplicated per screen.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Every `notify` / confirm-dialog / empty-state / upload-summary string resolves through a translation key (no literals at the call sites).
- [ ] Shared messages live under a `common` group; the keys exist in `en` (and are mirrored to `de` by TASK-1890).

## Test obligations
- Unit: covered by [TEST-0617] (no-literal grep at notify/confirm call sites).
- E2E: covered by [TEST-0617] (manual: trigger a toast/confirm in `de`).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0603], [STORY-0604], [STORY-0607], [STORY-0611]

## References
- UX review 2026-06-22 (cross-cutting i18n — feedback/dialog strings hardcoded).
- `notify` (TASK-1800), `ConfirmDialogComponent` (TASK-1801), `apps/openbucket-frontend/src/app/objects/object-upload.component.ts`, `apps/openbucket-frontend/src/app/i18n/en.translations.ts`.
