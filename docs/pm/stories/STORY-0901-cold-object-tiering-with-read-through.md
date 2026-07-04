---
id: STORY-0901
title: Cold-object tiering / offload with read-through
epic: EPIC-10
status: backlog
size: L
risk: high
---

## User story

As an operator running OpenBucket on a small local disk, I want cold objects
(not read within a policy window) to be offloaded to my configured
S3-compatible remote and transparently fetched back on GET, so that I reclaim
local disk without breaking clients or losing data.

## Description

This Story adds a lifecycle-driven *transition* tier on top of the existing
expiration sweep. A background runner (mirroring
[`LifecycleSweepRunner`](../../../libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts))
selects objects whose last access is older than a rule's transition window,
uploads the plaintext blob to the STORY-0900 remote, then deletes the local
blob and marks the `ObjectEntity` row as remote-resident (a "stub"), flipping
its `storageClass` and a new `location` field. On GET/HEAD the object read path
(`ObjectService.getObject` / `openObjectStream`) detects a remote stub and
either streams the bytes back read-through within a bounded latency (with
single-flight rehydration and the existing F1 read-time integrity gate) or, for
large objects, redirects to a short-lived presigned URL on the remote. It
produces: new object-location tracking columns + migration, a `TieringSweepRunner`,
a rehydration seam, config knobs, and storage-class/location surfaced in
metadata responses.

## Acceptance criteria

- [ ] `ObjectEntity` tracks object location (`LOCAL` / `REMOTE` / `REHYDRATING`),
      the remote key, and `lastAccessedAt`; a forward-only migration adds the
      columns as nullable/defaulted so existing rows stay valid.
- [ ] A lifecycle `transition` rule (Days + target `StorageClass`) is honoured by
      a 60s background tick that offloads matching, cold, current objects: the
      local blob is removed and the row becomes a remote stub, transactionally.
- [ ] Offload never runs unless a STORY-0900 remote target is configured and the
      object's bytes are confirmed durable on the remote (HEAD/etag match) before
      the local blob is deleted — no window where the only copy is in-flight.
- [ ] GET/HEAD of a tiered object is transparent: the client receives identical
      bytes, `ETag`, `Content-Type`, and (for GET) a body that passes the F1
      SHA-256 integrity check, within `OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS`,
      or a `307`/`303` redirect to a presigned remote URL when the object exceeds
      `OPENBUCKET_TIER_INLINE_MAX_BYTES`.
- [ ] Concurrent GETs of the same tiered key trigger exactly one rehydration
      (single-flight); rehydrated bytes are staged via the two-phase
      `BlobStore` write and respect the free-space guard (TASK-2140).
- [ ] Read-through preserves the EPIC-08 security posture: the request still
      passes SigV4 + `PolicyAuthorizationGuard` before any remote fetch, remote
      keys are derived via `key-codec`, presigned redirects carry no static
      credentials, and rehydration is bounded (concurrency cap + inline-size cap)
      so it cannot be used as a disk-fill or remote-stampede DoS.
- [ ] `x-amz-storage-class` (HEAD) and `GetObjectAttributes` report the tiered
      class; the admin object browser shows location.

## Tasks

- [TASK-2710] Extend the object data model to track storage-class/location and lifecycle transitions
- [TASK-2711] Implement the cold-object selection policy and tiering sweep runner
- [TASK-2712] Implement transparent read-through rehydration on GET/HEAD
- [TASK-2713] Add tiering configuration knobs and background/storage module wiring
- [TASK-2714] Surface storage-class and location in metadata and admin responses

## Test plan

- [TEST-0901] Cold-object tiering & read-through

## Dependencies

- Blocks: [STORY-0902]
- Blocked by: [STORY-0900] (durable outbox + remote S3-compatible client / target
  configuration is consumed here as the offload + rehydrate transport).
- Reuses EPIC-08 authz: [TASK-2120] bucket-policy evaluation and the
  `operationToAction` mapping gate the GET *before* read-through runs; the
  free-space guard [TASK-2140] and S3 rate limit [TASK-2141] bound rehydration.

## References

- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `getObject`,
  `openObjectStream`, `verifyBlobIntegrity`, `RANGE_VERIFY_MAX_BYTES`,
  `scanForLifecycle`, `moveToTrash` (read-through + sweep seams).
- `libs/nestjs/src/lib/storage/blob-store.ts` — `getBlob`/`putBlob`/`headBlob`/
  `deleteBlob`, two-phase tmp→fsync→rename, `MaxBlobSizeExceededError`.
- `libs/nestjs/src/lib/domain/lifecycle/lifecycle.service.ts` +
  `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts` — sweep/cursor
  pattern to mirror; `common/background/background.service.ts` (`ScheduledTask`).
- `libs/nestjs/src/lib/persistence/entities/object.entity.ts`,
  `.../entities/types.ts` (`StorageClass`, `LifecycleRule`),
  `.../entities/lifecycle-state.entity.ts` (cursor entity to mirror).
- `libs/nestjs/src/lib/common/config/env.schema.ts` (add tiering knobs);
  `libs/nestjs/src/lib/migrations/` (forward-only migration).
- Security: `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts`,
  `.../authz/operation-action.ts`, `.../authz/policy-authorization.guard.ts`,
  `libs/nestjs/src/lib/storage/key-codec.ts`.
- Interfaces consumed: `RemoteObjectStore` (defined in STORY-0900) —
  `putObject` / `getObject` / `headObject` / `presignGet`.
- New/updated deps: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
  (remote transport + presigned redirect; introduced by STORY-0900, reused here).
