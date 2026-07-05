---
id: STORY-1200
title: Multer storage engine + NestJS upload adapter
epic: EPIC-13
status: backlog
size: M
risk: low
---

## User story
As a developer with an existing Express/NestJS app that already uses `multer`
(`FileInterceptor`), I want a drop-in multer `StorageEngine` that writes uploads
straight into OpenBucket, so that I can adopt the store in one line without
rewriting my upload handlers or standing up temp-file plumbing.

## Description
Ship a multer `StorageEngine` factory — `openBucketStorage(ob, { bucket, key?,
validate?, ... })` — that implements `_handleFile` / `_removeFile` by streaming
the busboy part straight through `OpenBucketService.uploadFrom` (no temp files,
no full-buffer in memory), plus a `@UploadedToBucket()` NestJS param decorator
that returns the committed `{ key, url }` (and the rest of the result). These
ship as EXPORTS of the existing `@openbucket/nestjs` package under a new
`@openbucket/nestjs/multer` subpath export — NOT a second npm package — so
`multer` stays an optional peer that headless hosts never pull in. The existing
README upload recipe is extended to show the one-line wiring. The adapter is a
thin, in-process wrapper over `uploadFrom`; it adds no S3 wire surface and
inherits every existing upload gate (content-type sniffing, active-content
rejection, `assertSafeKey`, the `validate.maxBytes` mid-stream abort).

## Acceptance criteria
- [ ] `import { openBucketStorage } from '@openbucket/nestjs/multer'` resolves and
      `openBucketStorage(ob, { bucket: 'uploads' })` returns an object with
      `_handleFile` and `_removeFile` methods (a valid multer `StorageEngine`).
- [ ] Wiring `FileInterceptor('file', { storage: openBucketStorage(ob, { bucket }) })`
      and POSTing a multipart file writes the object into OpenBucket via
      `uploadFrom` (verified by a `headObject` on the returned key) with **no**
      temp file created and without buffering the whole body in memory.
- [ ] The engine streams the busboy part (`file.stream`, a `Readable`) — it does
      not read `file.buffer`; a > `validate.maxBytes` body is aborted mid-write
      and commits **no** partial object.
- [ ] A per-request dynamic key (the `key` option as a function) is routed through
      `uploadFrom`'s `keyStrategy` so it passes `assertSafeKey`; a function that
      returns `../evil` or a control-char key is rejected, not stored.
- [ ] On upload rejection `uploadFrom` throws `UploadValidationError`; the adapter
      surfaces it through multer such that a host that installs the provided
      `UploadValidationExceptionFilter` (or reads `err.statusHint`) returns HTTP
      `400`, never `500`.
- [ ] `_removeFile` deletes the already-committed object (`deleteObject`) so a
      multi-file request where a *later* part fails leaves no orphaned blobs.
- [ ] `@UploadedToBucket()` returns `{ bucket, key, url, etag, size, contentType }`
      for the single-file case and an array for the multi-file case; it returns
      `undefined` when no file was uploaded.
- [ ] `multer` is declared an **optional peer dependency** of `@openbucket/nestjs`
      and `@types/multer` a dev dependency; the main `.` entrypoint does not import
      `multer`, so a headless/non-Express host still builds and boots.
- [ ] The standalone backend still bundles clean: the new dep follows the 3-place
      native-dep externalization rule (`libs/nestjs/package.json` →
      generated `apps/openbucket-backend` manifest → webpack `externalDependencies`).
- [ ] `libs/nestjs/README.md` shows the one-line `storage: openBucketStorage(...)`
      recipe alongside the existing `uploadFrom` recipe.
- [ ] Secret posture preserved: the adapter logs no credentials/keys, and (like
      `uploadFrom`) sits inside the SigV4/policy perimeter (EPIC-08) adding no
      metrics/log surface that could leak secrets.

## Tasks
- [TASK-3600] Implement the `openBucketStorage` multer StorageEngine
- [TASK-3601] Add the `@UploadedToBucket()` NestJS param decorator
- [TASK-3602] Add the `UploadValidationError` → HTTP 400 multer exception filter
- [TASK-3603] Wire the `@openbucket/nestjs/multer` subpath export + optional peer dep
- [TASK-3604] Extend the README with the one-line multer storage recipe

## Test plan
- [TEST-1200] Multer storage engine + upload adapter — unit + e2e round-trip

## Dependencies
- Blocks: [STORY-1201]
- Blocked by: [STORY-0803] (`uploadFrom` + validation + key strategies, already shipped)

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` — `OpenBucketService.uploadFrom`
  (`:291`), `UploadOptions`/`UploadResult`/`MulterFileLike` (`:42`–`:92`),
  `deleteObject` (`:488`), `presignGetUrl` (`:515`).
- `libs/nestjs/src/lib/open-bucket-upload.ts` — `UploadValidationError`
  (`statusHint = 400`), `assertSafeKey`, `resolveKey` (custom `KeyStrategy`
  functions are `assertSafeKey`-guarded), `UploadValidateOptions`, `KeyStrategy`.
- `libs/nestjs/src/index.ts` — public barrel (already re-exports `UploadValidationError`,
  `KeyStrategy`, `UploadValidateOptions`).
- `libs/nestjs/package.json` — `exports` map; `peerDependencies`.
- `apps/openbucket-backend/webpack.config.js` — `externalDependencies` derivation
  (the 3-place native-dep rule).
- `libs/nestjs/README.md` — "Recipe: accept file uploads and store their URLs".
- Interfaces consumed: `OpenBucketService`, `UploadOptions`, `UploadValidateOptions`,
  `KeyStrategy` (STORY-0803); multer's `StorageEngine` (from `@types/multer`).
- Interfaces produced: `openBucketStorage`, `OpenBucketStorageOptions`,
  `@UploadedToBucket`, `UploadedFileInfo`, `UploadValidationExceptionFilter`.
- New dep: `multer` (optional peer, already at workspace root `^2.2.0`),
  `@types/multer` (dev).
