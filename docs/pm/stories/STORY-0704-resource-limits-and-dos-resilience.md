---
id: STORY-0704
title: Resource limits & DoS resilience
epic: EPIC-08
status: ready
size: L
risk: medium
---

## User story
As an operator, I want the S3 data plane and the backup/restore path to enforce
storage quotas, request-rate limits, pagination, and decompression caps, so that a
single credential holder (or a hostile backup archive) cannot exhaust disk, memory,
or CPU and take the whole instance down for every tenant.

## Description
The security audit confirmed five availability findings that share one root cause:
the write and restore paths allocate resources with no ceiling. There is no disk or
object-count quota anywhere in the write path and `MAX_OBJECT_SIZE_MB` defaults to
5 TiB (finding #6); the S3 controllers carry no rate limiting while admin login does
(finding #12); `ListParts` serializes every part row and lies about `MaxParts`/
`IsTruncated` (finding #13); and the restore path streams unbounded decompressed
bytes into the writer and buffers `manifest.json` fully in memory, either of which
lets a crafted `.zip` fill the disk mid-restore (destructive) or OOM the process
(findings #21, #22). This Story adds the missing baseline limits: a free-space/quota
guard, an S3-surface throttler, real `ListParts` pagination, a streaming
decompression-bomb cap with staged-then-swap restore, and a `manifest.json` size cap.

## Acceptance criteria
- [ ] A free-space (statfs) preflight rejects writes with an S3 `InsufficientStorage`/
      `ServiceUnavailable` (HTTP 507/503) when free space on `DATA_DIR` falls below a
      configurable reserve, covering both committed PutObject and multipart staging.
- [ ] The default `MAX_OBJECT_SIZE_MB` is lowered from 5 TiB to a sane value (e.g.
      5 GiB) and the multipart write path honours the configured `MAX_MULTIPART_PARTS`
      instead of a hardcoded `10000`.
- [ ] An `APP_GUARD`-level `ThrottlerGuard` (or per-IP/per-access-key equivalent)
      applies to the S3 controllers, not only admin login; exceeding the limit returns
      a `SlowDown`/429 response.
- [ ] `ListParts` honours `max-parts` (clamped to `[1, 1000]`) and `part-number-marker`
      with a real DB `limit`, and reports `MaxParts`, `IsTruncated`, and
      `NextPartNumberMarker` truthfully.
- [ ] A restore archive whose decompressed size, per-entry size, or entry count
      exceeds the configured cap is rejected before the disk fills; a failed
      whole-instance restore does not leave the instance wiped.
- [ ] `manifest.json` larger than a configurable cap (a few MB) is rejected with 400
      before it is buffered or parsed.

## Tasks
- [TASK-2140] Add storage quota + free-space guard and review MAX_OBJECT_SIZE_MB
- [TASK-2141] Rate-limit the S3 API surface
- [TASK-2142] Paginate ListParts (honour max-parts / part-number-marker)
- [TASK-2143] Cap restore decompression bomb (size/count/ratio) and stage-then-swap
- [TASK-2144] Cap manifest.json read size

## Test plan
- [TEST-0704] Quota, rate-limit, ListParts pagination, and restore-bomb caps

## Dependencies
- Blocks: (hardened 0.1.x line / 1.0 readiness)
- Blocked by: [STORY-0700] — the critical unauthenticated admin-API bypass
  ([TASK-2100], CWE-178) is P0 and must land first as a patch release: until the
  admin guard is fail-closed, the restore endpoint that [TASK-2143]/[TASK-2144]
  harden is itself reachable without a token, so the P0 fix gates the value of this
  Story's backup-path hardening.

## References
- White-box security audit, 2026-07-04 — findings #6, #12, #13, #21, #22 (all CONFIRMED).
- `libs/nestjs/src/lib/common/config/env.schema.ts:52` — `MAX_OBJECT_SIZE_MB` default 5 TiB; `:53` `MAX_MULTIPART_PARTS`; `:54` `MULTIPART_TTL_HOURS`.
- `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts:91,146,180` — the only per-object size cap.
- `libs/nestjs/src/lib/storage/blob-store.ts:69` — `putBlob` (no `maxSize` guard).
- `libs/nestjs/src/lib/admin/admin.module.ts:46,53` — `ThrottlerModule.forRoot`; only `JwtAuthGuard` bound as `APP_GUARD`.
- `libs/nestjs/src/lib/s3/controllers/{object,bucket,service,multipart}.controller.ts` — guarded only by `SigV4Guard`.
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:367,374` — `listParts` unbounded `find` + hardcoded `MaxParts`/`IsTruncated`.
- `libs/nestjs/src/lib/admin/backup/backup.service.ts:186,200` (instance restore), `:170` (bucket restore), `:341` (`readManifest` buffering), `:357` (`forEachObjectEntry`), `:326` (`readZip`).
- Interfaces consumed: `AppConfigService.maxObjectSizeMb`/`maxMultipartParts` (`app-config.service.ts:28-29`), `ObjectWriterService.put`, `BlobStore.putBlob`.
</content>
</invoke>
