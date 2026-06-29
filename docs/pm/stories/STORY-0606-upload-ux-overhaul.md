---
id: STORY-0606
title: Upload UX overhaul — progress, drag affordance, cancel/retry, summary
epic: EPIC-07
status: done
size: M
risk: medium
---

## User story
As an operator uploading files, I want a drop zone that lights up on drag, themed per-file progress, the ability to cancel/retry, a clear "N of M uploaded" summary, and feedback when a new version is created, so large or partial uploads are legible and recoverable.

## Description
`object-upload.component.ts` PUTs each file with progress but uses a native `<input type=file>` and native `<progress>`, shows no drag-over state, can't cancel (the subscription is discarded) or retry, never clears completed rows, and ignores the returned `x-amz-version-id`. The drop zone is also mouse-only/unlabeled (a11y gap).

## Acceptance criteria
- [ ] Native `<progress>` replaced by `HlmProgress`; the file input is wrapped in a real `<label>` ("Upload files to {prefix}") and styled via `hlmBtn`.
- [ ] A `dragOver` signal toggles a highlighted dropzone on dragover/dragleave/drop; the dropzone has a keyboard-reachable, named alternative.
- [ ] Per-file Cancel (`unsubscribe`) and Retry (re-run) are available; completed rows clear after a delay.
- [ ] An aggregate "{done}/{total} uploaded, {failed} failed" footer + a final summary toast; on a versioned bucket the new version id is surfaced.
- [ ] Optional folder upload (`webkitdirectory`); errors shown via toast, not raw `(err as Error).message`.

## Tasks
- [TASK-1830] Swap `<progress>` → `HlmProgress`; wrap input in `<label>` + `sr-only` instructions; style trigger with `hlmBtn`.
- [TASK-1831] Add `dragOver` signal + highlight on dragover/leave/drop; mark the decorative dropzone `aria-hidden`.
- [TASK-1832] Keep the PUT `Subscription` for per-row Cancel; add Retry on errored rows; clear completed rows.
- [TASK-1833] Add aggregate footer (`computed`) + final `notify` summary; surface `x-amz-version-id`.
- [TASK-1834] Add `webkitdirectory` folder upload (optional) and overwrite awareness.

## Test plan
- [TEST-0606] Unit (aggregate computed; cancel/retry state) + manual: drag highlight; per-file progress/cancel/retry; summary + toast; version id surfaced on a versioned bucket.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (interaction D/F6; power-user F10; a11y F3).
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts`, `libs/ui/spartan/{progress,button}`, `libs/api-client/src/lib/api/objects-admin.service.ts`.
