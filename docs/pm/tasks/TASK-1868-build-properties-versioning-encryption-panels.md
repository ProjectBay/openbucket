---
id: TASK-1868
title: Build the Properties / Versioning / Encryption panels wired to the admin endpoints
story: STORY-0613
status: done
type: implementation
size: M
---

## Description
Fill the Properties, Versioning, and Encryption tabs of the bucket-detail page. Properties shows read-only bucket facts + the object-lock status badge; Versioning is a `hlm-switch` toggle; Encryption is a default-encryption (SSE-S3) toggle. All read/write goes through the regenerated `@openbucket/api-client` admin services (STORY-0612); every save toasts; unconfigured features show an `hlm-empty` state.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` — modify (Properties/Versioning/Encryption panel bodies)
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.signal-store.ts` — new (signal store wrapping the new `BucketsAdminService` config methods), OR extend `buckets.signal-store.ts`

## Implementation notes
- Client services: the regenerated `@openbucket/api-client` (from [TASK-1865]) exposes `BucketsAdminService` with `getBucket`, `putBucketVersioning`, `get/putBucketEncryption`, `get/putBucketObjectLock`, etc. Wrap them in a signal store the same way `buckets.signal-store.ts` wraps `BucketsAdminService.listBuckets()` (`firstValueFrom(this.api.<method>(...))`, readonly signals, mutate on success).
- Versioning toggle: `import { HlmSwitchImports } from '@openbucket/spartan-ui/switch';` (`[HlmSwitch, HlmSwitchThumb]`). Bind the switch to the current versioning state; on toggle call `putBucketVersioning({ status: 'Enabled' | 'Suspended' })`. Note: S3/the domain has NO transition back to `Disabled` — once enabled, the switch toggles Enabled↔Suspended; surface that in the label/helper text.
- Encryption toggle: default SSE-S3 only (`AES256`). On → `putBucketEncryption({ algorithm:'AES256' })`; Off → `deleteBucketEncryption(name)`. A GET 404 (`ServerSideEncryptionConfigurationNotFound`) means "off" — show the `hlm-empty` state, not an error.
- Object-lock badge: `import { HlmBadgeImports } from '@openbucket/spartan-ui/badge';`. Read `getBucketObjectLock`; show an "Object Lock: Enabled/Disabled" badge (GET 404 = disabled). Read-only in v1 (enabling object lock at bucket level is a create-time concern).
- Properties tab: render read-only facts from `getBucket` (name, createdAt, objectCount, sizeBytes) — reuse `ByteSizePipe`/`RelativeTimePipe` from `shared/ui`.
- Toasts: every successful mutation fires `notify.success(...)`; failures `notify.error(...)`. `notify` is the helper from TASK-1800 (`shared/ui/notify.ts`). Map a 400 to a "validation failed" message (backend returns 400 ValidationFailed, `[[project_admin_api_spec_drift]]`).
- Empty state: `import { HlmEmptyImports } from '@openbucket/spartan-ui/empty';` — render for any GET-404 "unconfigured" feature with a short call-to-action.
- Build on **Node 23** (`[[project_frontend_node23_build]]`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Toggling Versioning persists via `putBucketVersioning` and a success toast fires; reload shows the persisted state.
- [ ] Encryption toggle on/off round-trips (`put`/`deleteBucketEncryption`); the off state shows `hlm-empty`, not an error.
- [ ] The object-lock badge reflects `getBucketObjectLock` (404 → "Disabled"); Properties shows live bucket facts.

## Test obligations
- Unit: covered by [TEST-0613] (store/panel behavior, if harness wired).
- E2E: covered by [TEST-0613] (tab persists config via the admin API).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1867] (the shell), [STORY-0612] (the endpoints + regenerated client), TASK-1800 (`notify`)

## References
- UX review 2026-06-22 (power-user D — versioning/encryption/object-lock).
- `apps/openbucket-frontend/src/app/buckets/buckets.signal-store.ts` (wrap pattern), `libs/api-client` (`BucketsAdminService` new methods), `libs/ui/spartan/{switch,badge,empty}`, `shared/ui/notify.ts` (TASK-1800), `shared/ui/{byte-size,relative-time}.pipe.ts`.
- See `[[project_frontend_node23_build]]`, `[[project_admin_api_spec_drift]]`.
