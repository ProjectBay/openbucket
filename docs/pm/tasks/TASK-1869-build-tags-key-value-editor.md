---
id: TASK-1869
title: Build the Tags key/value editor (bucket tagging endpoints)
story: STORY-0613
status: done
type: implementation
size: M
---

## Description
Fill the Tags tab with a key/value editor over the bucket tagging admin endpoints (STORY-0612). The operator adds/edits/removes rows; Save writes the full tag set; an unconfigured (untagged) bucket shows an `hlm-empty` state. Every save toasts; deleting all tags clears the tag set.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` — modify (Tags panel body), OR extract `apps/openbucket-frontend/src/app/buckets/tags-editor.component.ts` — new (standalone child component) if the detail file grows large
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.signal-store.ts` — modify (tag get/put/delete methods)

## Implementation notes
- Client methods: `BucketsAdminService.getBucketTagging(name)` → `{ tags: Record<string,string> }`; `putBucketTagging(name, { tags })`; `deleteBucketTagging(name)`. GET returns 404 (`NoSuchTagSet`) when untagged → render `hlm-empty`, not an error.
- Editor model: a list of `{ key, value }` rows backed by signals; "Add tag" appends an empty row; each row has key+value text inputs + a remove button. Save serializes the rows into `Record<string,string>` and calls `putBucketTagging`; if the list is emptied, call `deleteBucketTagging` (the AC's "clears the tag set"). Use `FormsModule` `[(ngModel)]` like `bucket-list.component.ts`, or reactive forms.
- Validation: reject empty/duplicate keys client-side before save (the backend stores a `Record`, so duplicate keys silently collapse — guard in the UI). On a 400 from the backend (`ValidationFailed`, `[[project_admin_api_spec_drift]]`) show `notify.error` with a validation message.
- Toasts: `notify.success('Tags saved')` / `notify.error(...)` from `shared/ui/notify.ts` (TASK-1800).
- Empty state: `HlmEmptyImports` from `@openbucket/spartan-ui/empty` with an "Add your first tag" CTA when the bucket has no tags.
- Build on **Node 23** (`[[project_frontend_node23_build]]`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Adding rows + Save persists via `putBucketTagging`; reload shows the saved tags; a success toast fires.
- [ ] An untagged bucket (GET 404) shows the `hlm-empty` state, not an error banner.
- [ ] Removing all rows + Save clears the tag set (`deleteBucketTagging`); duplicate/empty keys are rejected before save.

## Test obligations
- Unit: covered by [TEST-0613] (editor model + save, if harness wired).
- E2E: covered by [TEST-0613] (tag round-trip via the admin API).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1867] (the shell), [STORY-0612] (bucket tagging endpoints + client), TASK-1800 (`notify`)

## References
- UX review 2026-06-22 (power-user D — bucket tags editor).
- `libs/api-client` (`BucketsAdminService.get/put/deleteBucketTagging`), `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` (`[(ngModel)]` form pattern), `libs/ui/spartan/empty`, `shared/ui/notify.ts` (TASK-1800).
- See `[[project_frontend_node23_build]]`, `[[project_admin_api_spec_drift]]`.
