---
id: TASK-2140
title: Add storage quota + free-space guard and lower MAX_OBJECT_SIZE_MB default
story: STORY-0704
status: ready
type: implementation
size: L
---

## Description
Remediates audit finding #6 (MEDIUM, **CWE-770** Allocation of Resources Without
Limits or Throttling). There is no per-tenant, per-bucket, or global disk/object
quota anywhere in the write path, `MAX_OBJECT_SIZE_MB` defaults to ~5 TiB, and
abandoned multipart staging persists for 24 h. Because the SQLite metadata DB and
blob data share `DATA_DIR`, any credential holder can fill the volume with staged
parts and deny the whole instance (writes fail, the DB cannot checkpoint). This Task
adds a free-space preflight, aggregate quota enforcement, a bounded concurrent-upload
cap, a much smaller default object size, and wires the write path to the configured
`MAX_MULTIPART_PARTS`.

## Files to create / modify
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify: lower the
  `MAX_OBJECT_SIZE_MB` default; add limit vars `DATA_DIR_MIN_FREE_BYTES` (free-space
  reserve), optional `STORAGE_QUOTA_BYTES` / `STORAGE_QUOTA_OBJECTS`, and
  `MAX_CONCURRENT_MULTIPART_UPLOADS`.
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify: add typed
  getters for the new limit vars (mirror `maxObjectSizeMb` at `:28`).
- `libs/nestjs/src/lib/storage/free-space.service.ts` — new: a `statfs(DATA_DIR)`
  preflight that returns available bytes and throws an S3 `InsufficientStorage`/
  `ServiceUnavailable` when free space is below the reserve.
- `libs/nestjs/src/lib/storage/blob-store.ts` — modify: call the free-space guard in
  `putBlob` (`:69`) before opening the staging write stream.
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` — modify: replace the
  hardcoded `partNumber ... > 10_000` check (`:281`, and `uploadPartCopy` at `:317`)
  with `this.config.maxMultipartParts`; cap concurrent open uploads per access key in
  `createUpload`.
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` (or the
  metadata layer) — modify: expose an aggregate `sum(size)` / object-count lookup for
  the quota check.

## Implementation notes
- Vulnerable state today: `env.schema.ts:52` is
  `MAX_OBJECT_SIZE_MB: z.coerce.number().int().positive().max(5_242_880).default(5_120_000)`
  (5 TiB) and this is the *only* per-object cap, enforced solely in
  `put-object.interceptor.ts` (`maxBytes = this.config.maxObjectSizeMb * 1024 * 1024`
  at `:91`; `EntityTooLargeError` at `:146`/`:180`). Ship a far smaller default —
  `.default(5_120)` (5 GiB) — and let operators raise it.
- `multipart.service.ts:281` hardcodes `partNumber < 1 || partNumber > 10_000`,
  ignoring the configurable `MAX_MULTIPART_PARTS` (`app-config.service.ts:29`
  `maxMultipartParts`). Replace the literal `10_000` with `this.config.maxMultipartParts`
  in both `uploadPart` (`:281`) and `uploadPartCopy` (`:317`) so lowering the knob
  actually reduces amplification.
- Free-space guard: `import { statfs } from 'node:fs/promises'`; compute
  `free = bavail * bsize` and reject when `free - incomingBytes < DATA_DIR_MIN_FREE_BYTES`.
  Call it in `blob-store.ts` `putBlob` (`:69`) — the single sink covering both
  committed PutObject and multipart part staging — so one guard closes both vectors.
- Aggregate quota (optional, gated on `STORAGE_QUOTA_BYTES`): before committing a
  write, check `sum(object.size) + incoming <= quota`; reject with the same
  `InsufficientStorage` error. Track per-bucket/per-access-key where the model allows.
- Map the rejection to an S3 error the SDKs understand: HTTP 507 `InsufficientStorage`
  (or 503 `ServiceUnavailable`) with an XML `<Code>` body via the existing S3
  exception filter.

## Acceptance criteria
- [ ] With `DATA_DIR` free space below `DATA_DIR_MIN_FREE_BYTES`, a PutObject and an
      UploadPart both return an `InsufficientStorage`/`ServiceUnavailable` error and
      write no blob file.
- [ ] The default `MAX_OBJECT_SIZE_MB` resolves to 5 GiB (not 5 TiB) when unset, and
      `env.schema.spec.ts` reflects the new default.
- [ ] Setting `MAX_MULTIPART_PARTS=100` causes `UploadPart` with `partNumber=200` to
      return `InvalidArgument`, proving the write path honours the config knob.
- [ ] `nx test nestjs --testPathPattern=free-space` passes.

## Test obligations
- Unit: covered by [TEST-0704] (free-space guard, config default, part-cap wiring)
- E2E: covered by [TEST-0704] (fill-to-quota rejection over the S3 API)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2100], [STORY-0700]

## References
- White-box security audit, 2026-07-04 — finding #6 (CWE-770).
- `libs/nestjs/src/lib/common/config/env.schema.ts:52-54`
- `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts:91,146,180`
- `libs/nestjs/src/lib/storage/blob-store.ts:69`
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:281,317`
</content>
