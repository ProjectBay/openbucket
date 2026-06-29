---
id: TASK-1833
title: Add an aggregate upload footer (computed) + final notify summary; surface `x-amz-version-id`
story: STORY-0606
status: done
type: implementation
size: M
---

## Description
Make a multi-file upload legible end-to-end. Add a `computed` footer summarising "{done}/{total} uploaded, {failed} failed", fire a single `notify` toast when the batch settles, and surface the new version id returned by versioned buckets (the PUT response's `x-amz-version-id` header, currently ignored). Errors are reported via toast rather than the raw `(err as Error).message`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` — modify (aggregate `computed`, summary toast, read response header)

## Implementation notes
- Aggregate: add `readonly summary = computed(() => { const all = this.uploads(); return { total: all.length, done: all.filter(u => u.status === 'done').length, failed: all.filter(u => u.status === 'error').length }; });` (status field added in TASK-1832). Render the footer text "{{ summary().done }}/{{ summary().total }} uploaded, {{ summary().failed }} failed".
- Final toast: when the batch settles (no rows still `uploading`), fire `notify.success(...)` for an all-clean batch or `notify.error(...)` when any failed. Import `notify` from `apps/openbucket-frontend/src/app/shared/ui/notify.ts` (produced by STORY-0600 / TASK-1800: `notify.success`, `notify.error`, `notify.promise`). Replace `this.patch(id, { error: (err as Error).message })` raw-message display with a per-file `notify.error(...)`.
- Version id: the PUT must `observe: 'events'` (already does) and read the final `HttpResponse`. On the `HttpEventType.Response` event, read `event.headers.get('x-amz-version-id')`; if present, store it on the row and/or include it in the success toast. (On a non-versioned bucket the header is absent — surface nothing.)
- Keep the per-file progress events and the cancel/retry handling from TASK-1832 intact.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The footer shows a live "{done}/{total} uploaded, {failed} failed" count.
- [ ] A final summary toast fires once per batch (success when all succeed, error when any fail).
- [ ] On a versioned bucket, the new `x-amz-version-id` is surfaced (toast and/or row); on a non-versioned bucket nothing extra is shown.
- [ ] Errors are shown via toast, not the raw `(err as Error).message`.

## Test obligations
- Unit: covered by [TEST-0606] (aggregate `computed` math).
- E2E: covered by [TEST-0606] (manual: summary + toast; version id on a versioned bucket).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1832]

## References
- UX review 2026-06-22 (interaction F6 — no summary/feedback; power-user F10 — version id ignored).
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` (`uploads`, `startOne`, PUT `observe: 'events'`), `apps/openbucket-frontend/src/app/shared/ui/notify.ts` (`notify`, from STORY-0600), `@angular/common/http` (`HttpEventType`, `HttpResponse`).
- Interfaces consumed: `notify` (defined in STORY-0600 / TASK-1800).
