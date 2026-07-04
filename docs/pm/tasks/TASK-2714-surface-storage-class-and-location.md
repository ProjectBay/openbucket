---
id: TASK-2714
title: Surface storage-class and location in metadata and admin responses
story: STORY-0901
status: backlog
type: implementation
size: S
---

## Description

Expose the tiering state that TASK-2710 tracks so operators and S3 clients can
see it. Emit `x-amz-storage-class` on HEAD/GET when it is not `STANDARD`, report
the tiered class through `GetObjectAttributes`, and add object `location` to the
admin object-browser metadata so the console (STORY-0902) can render a
"tiered / local" badge.

## Files to create / modify

- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (`getObject`,
  `headObject`: emit `x-amz-storage-class`; `getObjectAttributes` already reads
  `obj.storageClass`; `head`/`AdminObjectMeta`: add `location`)
- `libs/nestjs/src/lib/admin/objects/` — modify (object-meta DTO/controller to
  carry `location` + `storageClass`, via `createZodDto` per the nestjs-zod pattern)
- `apps/openbucket-frontend/src/app/buckets/` — modify (signals-based object view:
  show a location/storage-class badge; no new store, extend the existing signal)

## Implementation notes

- HEAD/GET header: S3 omits `x-amz-storage-class` for `STANDARD` and emits it
  otherwise. In `headObject`/`getObject`, after the existing header block:
  ```ts
  if (obj.storageClass !== StorageClass.Standard)
    res.setHeader('x-amz-storage-class', obj.storageClass);
  ```
  This must be set *before* the first body byte (same constraint the file already
  documents). Note the redirect branch (TASK-2712) sets it too before redirecting.
- `getObjectAttributes` already returns `StorageClass` when requested (see the
  method reading `obj.storageClass`) — just confirm a tiered object reports
  `GLACIER`/`STANDARD_IA` rather than `STANDARD`; add a case if the attribute set
  omits it today.
- `AdminObjectMeta` (interface in `object.service.ts`) + the admin browser
  `head(...)`: add `location: obj.location` and keep `storageClass`. The admin
  list item already carries `storageClass`; add `location` there too so a listing
  can badge tiered rows without a per-row HEAD.
- Frontend: extend the existing bucket/object signal (see
  `apps/openbucket-frontend/src/app/buckets/*.signal-store.ts` and
  `bucket-detail.component.ts`) with the new fields and render a small badge.
  Reuse the existing Spartan/Hlm component styling; no new global state.
- Edge cases / security: this is read-only metadata over the object row —
  it never triggers a remote call (the row is the source of truth), so listing a
  bucket full of tiered objects stays cheap and cannot be turned into a remote
  fan-out. Do not leak the `remoteKey` or remote endpoint to the S3 wire or the
  admin API — expose only `location` (`local`/`remote`) + `storageClass`; the
  physical remote key is an internal detail (avoids handing an attacker the remote
  bucket layout).

## Acceptance criteria

- [ ] HEAD of a tiered object returns `x-amz-storage-class: GLACIER` (or the
      configured class); HEAD of a STANDARD object omits the header.
- [ ] `GetObjectAttributes` with `StorageClass` requested reports the tiered class.
- [ ] Admin object meta/listing includes `location` and `storageClass`; the
      response body never contains `remoteKey` or the remote endpoint.
- [ ] `nx test nestjs --testPathPattern=object.service` and the frontend
      component test pass.

## Test obligations

- Unit: covered by [TEST-0901] (header + admin-meta cases)
- E2E: covered by [TEST-0901] (HEAD after tier)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2710], [TASK-2711]
