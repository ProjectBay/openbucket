---
id: TASK-1832
title: Keep the PUT Subscription for per-row Cancel; add Retry + clear completed rows
story: STORY-0606
status: done
type: implementation
size: M
---

## Description
Make in-flight uploads recoverable. Today each PUT is awaited via `lastValueFrom` and the subscription is discarded, so an upload can't be cancelled and a failed one can't be retried, and completed rows never clear. Retain the underlying `Subscription` per row so Cancel can `unsubscribe()`, add Retry that re-runs the same file, and auto-clear successful rows after a short delay.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` — modify (`UploadState` shape, `startOne` to keep the sub, Cancel/Retry handlers, clear-on-complete)

## Implementation notes
- Extend `UploadState` (currently `{ id, name, progress, error? }`) with the source `file: File`, a `status: 'uploading' | 'done' | 'error' | 'cancelled'`, and a non-serialised `sub?: Subscription` (hold the live subscription, keyed by `id`, in a `Map<string, Subscription>` rather than in the rendered signal if you prefer to keep the signal value plain).
- Replace the `lastValueFrom(...).pipe(tap(...))` await in `startOne` with an explicit `.subscribe({ next, error, complete })` so the returned `Subscription` is captured. `next` updates progress on `HttpEventType.UploadProgress`; on the final `HttpEventType.Response` set `progress: 100`, `status: 'done'`, emit `uploaded`; `error` sets `status: 'error'` + message (via toast, see TASK-1833).
- `cancel(id)`: look up and `unsubscribe()` the row's `Subscription`, set `status: 'cancelled'`.
- `retry(id)`: re-run `startOne(row.file)` for the errored/cancelled row (reuse the same `id` or allocate a fresh one and drop the old row).
- Clear completed: after a row reaches `status: 'done'`, remove it from `uploads()` after a short `setTimeout` (e.g. 3s) so the list doesn't accumulate.
- Keep the existing `patch(id, fields)` helper and the one-time `encodeURIComponent` key contract.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cancel on an in-flight row `unsubscribe()`s the PUT and marks the row cancelled (progress stops; no `uploaded` emit).
- [ ] Retry on an errored/cancelled row re-issues the PUT for the same file.
- [ ] A successful row clears from the list after the delay.

## Test obligations
- Unit: covered by [TEST-0606] (cancel/retry state transitions; clear-on-done).
- E2E: covered by [TEST-0606] (manual: cancel mid-upload, retry, row clears).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1830]

## References
- UX review 2026-06-22 (interaction D/F6 — no cancel/retry; rows never clear).
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` (`UploadState`, `startOne`, `patch`, `uploaded`), `rxjs` (`Subscription`), `@angular/common/http` (`HttpEventType`).
