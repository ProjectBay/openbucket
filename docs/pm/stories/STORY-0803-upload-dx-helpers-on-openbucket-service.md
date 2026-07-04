---
id: STORY-0803
title: Upload DX helpers on OpenBucketService
epic: EPIC-09
status: backlog
size: M
risk: low
---

## User story
As a developer embedding `@openbucket/nestjs`, I want one-call upload helpers on
`OpenBucketService` that sniff the content type, validate size/type, extract image
dimensions, and pick a safe key, so that the "accept an upload → store it → return
a URL" recipe collapses from ~40 lines of boilerplate to a single call without
re-implementing (or getting wrong) the security-sensitive bits.

## Description
This Story adds higher-level upload sugar on top of the existing
`OpenBucketService.putObject` primitive (`libs/nestjs/src/lib/open-bucket.service.ts`).
It ships: a zero-dependency magic-byte content-type sniffer, an image-dimension
probe (via `image-size`), declarative validation options (max bytes, content-type
allowlist, active-content rejection), sanitized key strategies, and a single
`uploadFrom(source, { bucket, keyStrategy, validate })` that accepts a multer file,
a `Readable`, or a `Buffer` and returns `{ key, url, etag, size, contentType, image? }`.
All of it streams (bounded head-peek, no full-body buffering) and routes the write
through the same two-phase `ObjectWriterService` so durability, SSE-S3, versioning,
and the `maxSize` DoS cap are unchanged. The README upload recipe is rewritten to
use `uploadFrom`, shrinking it by roughly half.

## Acceptance criteria
- [ ] `OpenBucketService.uploadFrom(source, opts)` exists and accepts an
  `Express.Multer.File`, a `Readable`, or a `Buffer` as `source`.
- [ ] It returns `{ bucket, key, url?, etag, size, contentType, versionId?, image? }`;
  `url` is a presigned GET when `presign` (or a configured `endpoint`) is available,
  otherwise omitted (never a stale/incorrect URL).
- [ ] Content type is resolved by sniffing magic bytes from a bounded head buffer
  when `validate.sniffContentType` is `'prefer'` (default) or `'require'`; the
  caller-supplied / multer `mimetype` is used only as a fallback / cross-check.
- [ ] `validate.maxBytes` rejects oversized uploads: a known-length source (Buffer /
  multer file) is rejected before any write; a `Readable` is capped mid-stream via
  the writer's `maxSize` so the staged blob is unlinked (no partial commit, no disk
  fill).
- [ ] `validate.allowedContentTypes` (exact types and `type/*` wildcards) rejects a
  disallowed **sniffed** type with a typed validation error, before the write.
- [ ] With `validate.rejectActiveContent` (default `true`), a body that sniffs as
  `text/html`, `application/xhtml+xml`, or `image/svg+xml` is rejected, reusing
  `isActiveContentType` from `object.service.ts` (defense in depth vs stored XSS).
- [ ] Image dimensions (`{ width, height, type }`) are returned for recognized image
  types and parsed only from the bounded head buffer (no full-image decode).
- [ ] Key strategies (`'uuid'` default, `'uuid-flat'`, `'sha256'`, `'original'`, or a
  `(ctx) => string` function) produce keys that are sanitized against path traversal
  and control characters and are stable/valid for the S3 key space.
- [ ] The README recipe section renders using `uploadFrom` and is materially shorter;
  it still stores the stable `{ bucket, key }` and presigns on read.
- [ ] `nx test nestjs` passes, covering [TEST-0803].

## Tasks
- [TASK-2430] Add a zero-dependency magic-byte content-type sniffer
- [TASK-2431] Add an image-dimension probe (`image-size`) over a bounded head buffer
- [TASK-2432] Add upload validation options and sanitized key strategies
- [TASK-2433] Add `uploadFrom()` one-call helper to OpenBucketService
- [TASK-2434] Rewrite the README upload recipe to use the helpers

## Test plan
- [TEST-0803] Upload helpers — sniffing, validation, key strategies, and uploadFrom

## Dependencies
- Blocks: —
- Blocked by: none. Builds on the existing `putObject` / `ObjectWriterService` write
  path and `presignGetUrl` (all already shipped). Independent of [STORY-0800]
  (image transforms) and [STORY-0801]/[STORY-0802]; may reuse `sharp` from
  [STORY-0800] later for dimensions but does not depend on it landing first.
- Trust boundary: reuses — and must not weaken — the EPIC-08 posture. In-process
  helpers sit on the trusted host-app side of the SigV4 + policy-evaluator authz
  (`s3/authz/policy-evaluator.ts`, `s3/authz/policy-authorization.guard.ts`), exactly
  like `putObject` today; they add no new unauthenticated surface and do not bypass
  any check the wire path would have applied.

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` — `putObject`, `presignGetUrl`, the
  `withContext` ORM wrapper, `PutObjectResult`.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `putFromStream`,
  `isActiveContentType` / `ACTIVE_CONTENT_TYPES` (reused for active-content rejection).
- `libs/nestjs/src/lib/storage/object-writer.service.ts` — `ObjectWriterService.put`,
  `PutObjectCmd.maxSize` (TASK-2143 byte cap).
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — `maxObjectSizeMb`
  (default `maxBytes`).
- `libs/nestjs/src/lib/storage/key-codec.ts` — key encoding constraints for
  strategy-derived keys.
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts` — EPIC-08 authz boundary (not
  regressed).
- `libs/nestjs/README.md#recipe-accept-file-uploads-and-store-their-urls` — recipe rewrite.
- New dependency: `image-size` (pure-JS dimension probe). `file-type` considered and
  rejected (ESM-only; a small in-house sniffer avoids the CJS/DoS surface).
