---
id: TASK-1870
title: Build the Lifecycle rule-list editor (bucket lifecycle endpoints)
story: STORY-0613
status: done
type: implementation
size: M
---

## Description
Fill the Lifecycle tab with a rule-list editor over the bucket lifecycle admin endpoints (STORY-0612). The operator adds/edits/removes expiration rules (prefix + expiration days/enabled); Save writes the full rule set; an unconfigured bucket shows an `hlm-empty` state. Saving an empty rule set is rejected (the domain treats an empty `<LifecycleConfiguration>` as MalformedXML).

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` — modify (Lifecycle panel body), OR `apps/openbucket-frontend/src/app/buckets/lifecycle-editor.component.ts` — new (standalone child)
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.signal-store.ts` — modify (lifecycle get/put/delete methods)

## Implementation notes
- Client methods: `BucketsAdminService.getBucketLifecycle(name)` → `{ rules: LifecycleRuleDto[] }`; `putBucketLifecycle(name, { rules })`; `deleteBucketLifecycle(name)`. GET 404 (`NoSuchLifecycleConfiguration`) when unset → `hlm-empty`.
- Rule shape: align to the `LifecycleRuleDto` the backend emits ([TASK-1860]) — at minimum `{ id?, prefix?, status: 'Enabled'|'Disabled', expirationDays? }`. v1 scope is expiration (the domain accepts storage-class transitions but ignores them — single tier; surface only expiration in the UI, mention transitions are no-ops).
- Editor model: a list of rule rows backed by signals; "Add rule" appends a default rule; per-row inputs for prefix, expiration days, enabled toggle (`hlm-switch`), and a remove button. Save serializes to `{ rules }` and calls `putBucketLifecycle`; emptying the list calls `deleteBucketLifecycle` (NOT a `put` with `[]`, which the domain rejects as MalformedXML).
- Validation: each rule needs at least an expiration day count > 0; reject save when a rule is incomplete (the backend returns 400 ValidationFailed otherwise — `[[project_admin_api_spec_drift]]`).
- Toasts: `notify.success`/`notify.error` (`shared/ui/notify.ts`, TASK-1800). Empty state: `HlmEmptyImports` with an "Add lifecycle rule" CTA.
- Build on **Node 23** (`[[project_frontend_node23_build]]`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Adding a rule + Save persists via `putBucketLifecycle`; reload shows it; a success toast fires.
- [ ] An unconfigured bucket (GET 404) shows `hlm-empty`; removing all rules + Save calls `deleteBucketLifecycle` (not an empty `put`).
- [ ] An incomplete rule is rejected before save (no 400 round-trip on submit).

## Test obligations
- Unit: covered by [TEST-0613] (rule model + save, if harness wired).
- E2E: covered by [TEST-0613] (lifecycle round-trip via the admin API).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1867] (the shell), [STORY-0612] (lifecycle endpoints + `LifecycleRuleDto` in the client), TASK-1800 (`notify`)

## References
- UX review 2026-06-22 (power-user D — lifecycle rules).
- `libs/api-client` (`BucketsAdminService.get/put/deleteBucketLifecycle`, `LifecycleRuleDto`), `apps/openbucket-backend/src/domain/buckets/bucket.service.ts` (`putLifecycle` rejects empty rule set as MalformedXML), `libs/ui/spartan/{switch,empty}`, `shared/ui/notify.ts` (TASK-1800).
- See `[[project_frontend_node23_build]]`, `[[project_admin_api_spec_drift]]`.
