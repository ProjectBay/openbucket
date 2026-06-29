---
id: TEST-0606
title: Upload UX overhaul — progress, drag, cancel/retry, summary, version id
covers: [STORY-0606, TASK-1830, TASK-1831, TASK-1832, TASK-1833, TASK-1834]
status: done
level: e2e
---

## Goal
Verify the rebuilt upload component: themed per-file `HlmProgress`, a labelled/keyboard-reachable picker, a dropzone that highlights on drag, per-row Cancel/Retry with auto-clear of completed rows, an aggregate "{done}/{total} uploaded, {failed} failed" footer + final summary toast, surfaced `x-amz-version-id` on a versioned bucket, and optional `webkitdirectory` folder upload with overwrite awareness.

## Setup
- Frontend served against a running backend: `nx serve openbucket-frontend` (frontend on Node 23). Backend running so `PUT /api/admin/buckets/:name/objects/:path` accepts uploads.
- Two buckets: one versioning-disabled, one versioning-enabled (so the PUT response carries `x-amz-version-id` on the second). Use `aws-cli`/`mc` to create/enable versioning.
- A folder of files (including a large file, so progress and Cancel are observable) and a small directory tree for the `webkitdirectory` case. The shared `notify` toaster (STORY-0600) mounted.

## Cases
1. Progress + label: given files picked via the labelled control, then each file shows an `HlmProgress` bar advancing 0→100; the picker has an associated `<label>` naming the destination prefix and is operable by keyboard.
2. Drag highlight: given files dragged over the dropzone, then it highlights on `dragover` and un-highlights on `dragleave`/`drop`; the decorative dropzone is `aria-hidden` and a keyboard user can still start an upload.
3. Cancel: given a large in-flight upload, when Cancel is clicked, then the PUT `unsubscribe()`s, progress stops, the row is marked cancelled, and no `uploaded` event/version is emitted.
4. Retry: given an errored/cancelled row, when Retry is clicked, then the PUT re-issues for the same file and can complete.
5. Clear: given a successful upload, then its row clears from the list after the delay.
6. Aggregate + toast: given a multi-file batch, then the footer shows live "{done}/{total} uploaded, {failed} failed", and exactly one summary toast fires when the batch settles (success if all ok, error if any failed); errors show via toast, not raw `(err as Error).message`.
7. Version id: given the versioning-enabled bucket, then a successful upload surfaces the response `x-amz-version-id`; on the versioning-disabled bucket nothing extra is shown.
8. Folder upload (optional): given a directory picked via `webkitdirectory`, then files upload with keys preserving the relative path under the current prefix; a key that already exists in the listing is flagged as an overwrite.

## Tooling
- Framework: jest (`@testing-library/angular` optional) for the aggregate `computed` + cancel/retry state where the frontend harness runs; otherwise manual in the browser; `aws-cli`/`mc` to set up versioned buckets.
- Runner: `nx test openbucket-frontend --testPathPatterns=object-upload` (if wired); `nx serve openbucket-frontend` for manual; `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–8 verified (unit for the aggregate/cancel-retry state where the harness runs; otherwise manual).

## References
- UX review 2026-06-22 (interaction D/F6; power-user F10; a11y F3).
- STORY-0606 and TASK-1830..1834; `apps/openbucket-frontend/src/app/objects/object-upload.component.ts`.
