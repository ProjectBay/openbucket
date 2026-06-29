---
id: TASK-1871
title: Build the CORS + Policy editors (validated textarea)
story: STORY-0613
status: done
type: implementation
size: M
---

## Description
Fill the CORS and Policy tabs. v1 is a validated JSON editor for each (`hlm-textarea` per the AC), wired to the bucket CORS/policy admin endpoints (STORY-0612). The textarea is parsed/validated client-side before save; an unconfigured bucket shows an `hlm-empty` state; clearing the config is a confirmed, destructive action.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` — modify (CORS + Policy panel bodies), OR `apps/openbucket-frontend/src/app/buckets/json-config-editor.component.ts` — new (a reusable validated-textarea child used by both tabs)
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.signal-store.ts` — modify (cors + policy get/put/delete methods)

## Implementation notes
- Client methods: `BucketsAdminService.getBucketCors/putBucketCors/deleteBucketCors` and `getBucketPolicy/putBucketPolicy/deleteBucketPolicy`. GET 404 (`NoSuchCORSConfiguration` / `NoSuchBucketPolicy`) when unset → `hlm-empty`.
- Editor: `import { HlmTextareaImports } from '@openbucket/spartan-ui/textarea';`. Render the current config as pretty-printed JSON in the textarea; on Save, `JSON.parse` client-side first — on parse failure show an inline error + `notify.error('Invalid JSON')` and do NOT call the API. On valid JSON, call `putBucketCors({ rules })` / `putBucketPolicy({ policy })` matching the DTO shape the backend expects ([TASK-1860]).
- Policy: the backend stores the JSON verbatim (`PolicyDocument`); a malformed policy returns the domain `MalformedPolicy` (400). CORS: the backend parses into `CorsRuleDto[]` — send the shape the `putBucketCors` DTO expects.
- Clear config (DELETE) is destructive → gate it behind the confirm dialog (`ConfirmDialogComponent`, `shared/ui/confirm-dialog.component.ts`, from STORY-0600) before calling `deleteBucketCors`/`deleteBucketPolicy`.
- Toasts: `notify.success`/`notify.error` (`shared/ui/notify.ts`, TASK-1800). Empty state via `HlmEmptyImports`.
- Build on **Node 23** (`[[project_frontend_node23_build]]`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Editing valid JSON + Save persists via `putBucketCors`/`putBucketPolicy`; reload shows it; a success toast fires.
- [ ] Invalid JSON is caught client-side (no API call, inline error + error toast).
- [ ] An unconfigured bucket (GET 404) shows `hlm-empty`; "Clear" prompts the confirm dialog before `delete*`.

## Test obligations
- Unit: covered by [TEST-0613] (JSON validate + save, if harness wired).
- E2E: covered by [TEST-0613] (CORS/policy round-trip via the admin API).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1867] (the shell), [STORY-0612] (CORS/policy endpoints + DTOs in the client), TASK-1800 (`notify`), TASK-1801 (`ConfirmDialogComponent`)

## References
- UX review 2026-06-22 (power-user D — CORS + policy editors).
- `libs/api-client` (`BucketsAdminService.get/put/deleteBucketCors`/`*BucketPolicy`, `CorsRuleDto`), `apps/openbucket-backend/src/domain/buckets/bucket.service.ts` (`putPolicy` MalformedPolicy 400, `putCors`), `libs/ui/spartan/{textarea,empty}`, `shared/ui/{notify.ts,confirm-dialog.component.ts}`.
- See `[[project_frontend_node23_build]]`, `[[project_admin_api_spec_drift]]`.
