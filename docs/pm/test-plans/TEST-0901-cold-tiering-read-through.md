---
id: TEST-0901
title: Cold-object tiering & read-through
covers: [STORY-0901, TASK-2710, TASK-2711, TASK-2712, TASK-2713, TASK-2714]
status: backlog
level: integration
---

## Goal

Verify that objects idle past a lifecycle transition window are durably offloaded
to the remote and turned into local stubs, that GET/HEAD of a stub returns
byte-identical, integrity-verified content (proxied or via presigned redirect)
within the latency bound, that concurrent reads rehydrate exactly once, and that
none of this regresses the EPIC-08 authz posture or opens a disk-fill / stampede
DoS.

## Setup

- `nx test nestjs` (jest) for unit/service specs; the in-memory/libsql test EM
  used by existing entity specs, with the TASK-2710 migration applied.
- A fake `RemoteObjectStore` test double (in-memory map) standing in for the
  STORY-0900 client, plus a spy variant that counts `getObject`/`putObject`/
  `headObject` calls and can inject latency, truncation, and HEAD mismatches.
- `Clock` stub (as `lifecycle-sweep.runner.spec.ts` uses) to fast-forward the
  transition window; `FreeSpaceService` stub to force `assertWritable()` rejection.
- E2E round-trip via the backend e2e harness with `@aws-sdk/client-s3`: PUT →
  force-tier → GET, plus a raw HEAD to inspect `x-amz-storage-class`.

## Cases

1. **Data model & migration (TASK-2710).** Given a DB seeded with pre-tiering
   rows, when the migration runs, then every `objects.location` = `'local'`,
   the new columns + `ix_objects_lastaccessed` index exist, `tiering_state` is
   created, and all existing GET/HEAD specs stay green. `LifecycleRule` round-trips
   `transitionDays` + `transitionStorageClass` without dropping expiration fields.
2. **Cold selection (TASK-2711).** Given a bucket with a transition rule
   `transitionDays: 30, transitionStorageClass: GLACIER` and two objects — one
   with `lastAccessedAt` 40 days ago, one 5 days ago — when the sweep ticks with
   the clock advanced, then only the 40-day object is selected; the 5-day object
   stays `local`. Cursor advances and resets to `null` when the rule is exhausted.
3. **Durable offload ordering (TASK-2711).** When `tierToRemote` runs, then the
   remote receives the plaintext bytes first, a `headObject` size/etag match is
   asserted, and only then is the row flipped to `location='remote'` (with
   `remoteKey`, `tieredAt`, target `storageClass`) and the local blob moved to
   trash — verified by call ordering on the spy. If the remote HEAD mismatches,
   the row stays `local` and the local blob is untouched (a failure is logged).
4. **No remote / disabled (TASK-2711/2713).** With `OPENBUCKET_TIER_ENABLED=false`
   or no `RemoteObjectStore` injected, the runner mutates nothing and performs no
   remote calls.
5. **Read-through parity (TASK-2712).** Given a tiered stub whose bytes are in the
   fake remote, when a full GET is issued, then the response bytes, `ETag`,
   `Content-Type`, and `Content-Length` are identical to the pre-tier object and
   the F1 SHA-256 verify passes; afterwards the row is back to `location='local'`
   and a second GET makes no remote call.
6. **Single-flight (TASK-2712).** When two GETs of the same stub run concurrently,
   then `RemoteObjectStore.getObject` is invoked exactly once and both responses
   are complete and identical.
7. **Presigned redirect for large objects (TASK-2712).** Given an object larger
   than `OPENBUCKET_TIER_INLINE_MAX_BYTES`, when GET is issued, then the response
   is `307` to a presigned URL that is object-scoped, expires within
   `OPENBUCKET_TIER_PRESIGN_TTL_SECONDS`, and contains no long-lived/static
   credential; no local blob is written.
8. **Corrupt/slow remote is safe (TASK-2712).** A remote returning truncated bytes
   yields `500` with the staged blob unlinked (no partial local file); a remote
   slower than `OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS` yields `503 SlowDown`.
   With `FreeSpaceService.assertWritable()` throwing, rehydrate refuses before
   writing — disk is never filled past the guard.
9. **Authz not regressed (STORY-0901 / EPIC-08).** A GET that fails SigV4 or the
   `PolicyAuthorizationGuard` (`s3:GetObject` denied) is rejected *before* any
   remote fetch — the `RemoteObjectStore` spy records zero calls.
10. **Access clock (TASK-2712).** A GET/HEAD of a local object updates
    `lastAccessedAt` (throttled), so a subsequently-cold object is only selected
    once reads stop for the window — a recently-read object is not tiered.
11. **Metadata surfacing (TASK-2714).** HEAD of a tiered object returns
    `x-amz-storage-class: GLACIER`; a STANDARD object omits the header;
    `GetObjectAttributes` reports the tiered class; admin object meta/listing
    includes `location` + `storageClass` and never leaks `remoteKey` or the
    remote endpoint.
12. **Object-lock preserved (TASK-2711).** A tiered object under legal-hold /
    retention still refuses delete with `403 AccessDenied` (tiering moved only the
    bytes; the lock state on the row is unchanged).

## Tooling

- Framework: jest | supertest | @aws-sdk/client-s3
- Runner: `nx test nestjs` / `nx e2e openbucket-backend-e2e`

## References

- `libs/nestjs/src/lib/domain/objects/object.service.ts`,
  `libs/nestjs/src/lib/domain/tiering/tiering.service.ts`,
  `libs/nestjs/src/lib/common/background/tiering-sweep.runner.ts`,
  `libs/nestjs/src/lib/storage/blob-store.ts`,
  `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.spec.ts` (pattern),
  `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`.
