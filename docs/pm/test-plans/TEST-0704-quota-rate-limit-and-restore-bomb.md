---
id: TEST-0704
title: Quota, rate-limit, ListParts pagination, and restore-bomb caps
covers: [STORY-0704, TASK-2140, TASK-2141, TASK-2142, TASK-2143, TASK-2144]
status: ready
level: integration
---

## Goal
Verify the resource-limit controls added by [STORY-0704] actually bound disk, memory,
CPU, and response size: the free-space/quota guard and lowered object-size default
([TASK-2140]), the S3-surface throttler ([TASK-2141]), real `ListParts` pagination
([TASK-2142]), the restore decompression-bomb caps with non-destructive whole-instance
restore ([TASK-2143]), and the `manifest.json` size cap ([TASK-2144]). Each control
must reject the abusive input with the correct status/S3 error and leave the instance
intact.

## Setup
- A booted `@openbucket/nestjs` instance over a temp `DATA_DIR` on a small/quota-limited
  filesystem (or a mocked `statfs` returning low `bavail`) so the free-space branch is
  reachable deterministically.
- Valid root S3 credentials for signed requests; an `@aws-sdk/client-s3` client and a
  raw `supertest` agent for status/error-body assertions.
- A helper that builds backup `.zip` archives with a controllable `manifest.json` and
  synthetic `data/<bucket>/<key>` entries (including a highly compressible bomb entry
  and an oversized manifest entry) via `yauzl`/`yazl`.
- Env overrides per case: `MAX_OBJECT_SIZE_MB`, `MAX_MULTIPART_PARTS`,
  `DATA_DIR_MIN_FREE_BYTES`, `RESTORE_MAX_TOTAL_BYTES`, `RESTORE_MAX_ENTRY_BYTES`,
  `RESTORE_MAX_ENTRIES`, `RESTORE_MAX_MANIFEST_BYTES`, and the S3 throttle limit.

## Cases

### [TASK-2140] Storage quota, free-space, and size defaults
1. Given `statfs(DATA_DIR)` reports free space below `DATA_DIR_MIN_FREE_BYTES`, when a
   `PutObject` is issued, then the response is HTTP 507 `InsufficientStorage` (or 503
   `ServiceUnavailable`) and no blob file is written under `DATA_DIR/blobs`.
2. Given the same low-free-space condition, when an `UploadPart` is issued, then it is
   rejected identically — proving the guard sits in `putBlob` and covers both committed
   writes and multipart staging.
3. Given `MAX_OBJECT_SIZE_MB` is unset, when the config resolves, then
   `AppConfigService.maxObjectSizeMb === 5120` (5 GiB), not `5_120_000` — asserting the
   lowered default.
4. Given `MAX_MULTIPART_PARTS=100`, when `UploadPart` is called with `partNumber=200`,
   then it returns `InvalidArgument` — proving the write path honours the config knob
   instead of the former hardcoded `10000`.

### [TASK-2141] S3-surface rate limiting
5. Given the app boots, when the DI container is inspected, then a `ThrottlerGuard` is
   bound as an `APP_GUARD` (in addition to `JwtAuthGuard`).
6. Given the configured S3 rate limit is N/min, when a single client IP issues N+K
   rapid `GetObject`/`ListObjects` requests, then requests beyond the limit return HTTP
   429 (`SlowDown`/`ThrottlerException`) — the S3 controllers, not only admin login,
   are throttled.
7. Given the admin `login` throttler (5/min), when it is exercised, then its behaviour
   is unchanged (regression guard).

### [TASK-2142] ListParts pagination
8. Given a multipart upload with 5 parts, when `ListParts?max-parts=2` is requested,
   then the response contains exactly 2 `Part` elements, `IsTruncated=true`, and
   `NextPartNumberMarker` equal to the 2nd part number.
9. Given the `NextPartNumberMarker` from case 8, when it is passed as
   `part-number-marker`, then the next page of parts is returned and the final page has
   `IsTruncated=false` with no `NextPartNumberMarker`.
10. Given any `ListParts` response, then `MaxParts` echoes the effective (clamped
    `[1,1000]`) requested value rather than a hardcoded `1000`.

### [TASK-2143] Restore decompression bomb + non-destructive restore
11. Given a restore `.zip` whose decompressed total exceeds `RESTORE_MAX_TOTAL_BYTES`,
    when it is POSTed to the whole-instance restore endpoint, then the response is HTTP
    400, the disk is not filled, and no partial blobs remain.
12. Given a `.zip` with one entry exceeding `RESTORE_MAX_ENTRY_BYTES`, or whose observed
    decompressed size does not match its `manifest.objects[].size`, then restore is
    rejected with HTTP 400.
13. Given a `.zip` with more than `RESTORE_MAX_ENTRIES` payload entries, then restore is
    rejected with HTTP 400.
14. Given a pre-populated instance (buckets B1, B2 with objects) and a bomb archive,
    when the whole-instance restore fails mid-stream, then B1 and B2 and their objects
    are still present — proving the restore stages and swaps rather than wiping first.

### [TASK-2144] manifest.json size cap
15. Given a restore `.zip` whose `manifest.json` entry exceeds
    `RESTORE_MAX_MANIFEST_BYTES`, when it is POSTed to restore, then the response is HTTP
    400 and the request is rejected before the manifest is fully buffered or
    `JSON.parse`d (no OOM; stream destroyed at the cap).
16. Given a `.zip` with a small, valid `manifest.json`, when it is restored, then the
    restore succeeds — the cap does not regress normal archives.

## Tooling
- Framework: jest + supertest + `@aws-sdk/client-s3`; `yazl`/`yauzl` for archive
  fixtures; `statfs` mocked via jest for the free-space cases.
- Runner: `nx test nestjs` (unit/integration) and `nx e2e nestjs-e2e` for the
  over-the-wire restore and throttle cases.

## Pass criteria
- [ ] Free-space and quota rejections return the correct S3 error and write no bytes.
- [ ] Lowered `MAX_OBJECT_SIZE_MB` default and config-driven `MAX_MULTIPART_PARTS` are
      enforced.
- [ ] A `ThrottlerGuard` covers the S3 controllers and 429s a single-IP burst.
- [ ] `ListParts` honours `max-parts`/`part-number-marker` and reports truthful
      `MaxParts`/`IsTruncated`/`NextPartNumberMarker`.
- [ ] Decompression-bomb, oversized-entry, entry-count, and oversized-manifest archives
      are all rejected with 400 before resource exhaustion.
- [ ] A failed whole-instance restore leaves the existing instance fully intact.

## References
- White-box security audit, 2026-07-04 — findings #6, #12, #13, #21, #22.
- `libs/nestjs/src/lib/admin/backup/backup.service.ts`, `.../storage/blob-store.ts`,
  `.../domain/multipart/multipart.service.ts`, `.../admin/admin.module.ts`,
  `.../common/config/env.schema.ts`.
</content>
