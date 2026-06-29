---
id: TASK-1880
title: Handle presign errors (expiry too long, object missing) via toast
story: STORY-0615
status: done
type: implementation
size: XS
---

## Description
Map the presign endpoint's error responses to user-facing error toasts so a failed share-link request never fails silently. Covers expiry exceeding `MAX_EXPIRES`, the object not existing, and generic/network failures.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/share-link.component.ts` — modify (catch + map errors to `notify.error`)

## Implementation notes
- The presign endpoint (STORY-0612 / TASK-1863) validates and returns the project's standard error envelope: validation = `400 ValidationFailed` (per `[[project_admin_api_spec_drift]]`), and a missing object returns `404`. Map:
  - `400 ValidationFailed` (expiry over `MAX_EXPIRES`) → `notify.error('Expiry too long')` (i18n key from TASK-1881).
  - `404` (object missing / deleted between list and request) → `notify.error('Object not found')`.
  - any other / network error → `notify.error('Could not create share link')`.
- Because TASK-1879 wraps the request in `notify.promise(...)`, the `error` branch can carry the mapped message; this task is the explicit mapping of HTTP status → message and the catch for non-promise paths. Inspect `HttpErrorResponse.status` / `error.code` from `@angular/common/http`.
- Capping in the UI (TASK-1878) prevents the over-cap case in normal use; this is the defense-in-depth path for a server that caps lower than the offered options.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] A `400 ValidationFailed` (expiry too long) shows the "Expiry too long" toast; a `404` shows "Object not found"; other failures show a generic error toast.
- [ ] No presign failure is swallowed silently.

## Test obligations
- Unit: covered by [TEST-0615] (status→message mapping).
- E2E: covered by [TEST-0615] (manual: request a missing object → error toast).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1879]

## References
- UX review 2026-06-22 (power-user G; interaction — surface errors as toasts).
- `[[project_admin_api_spec_drift]]` (validation = 400 ValidationFailed), `@angular/common/http` (`HttpErrorResponse`).
- Interfaces consumed: `notify` (TASK-1800), presign endpoint (STORY-0612).
