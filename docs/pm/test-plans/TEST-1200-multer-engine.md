---
id: TEST-1200
title: Multer storage engine + NestJS upload adapter — unit + e2e round-trip
covers: [STORY-1200, TASK-3600, TASK-3601, TASK-3602, TASK-3603, TASK-3604]
status: backlog
level: e2e
---

## Goal
Verify that `openBucketStorage` is a valid multer `StorageEngine` that streams
uploads into OpenBucket with no temp files, that per-request keys stay
`assertSafeKey`-guarded, that rejections map to HTTP 400, that `_removeFile` rolls
back committed objects, and that `@UploadedToBucket()` returns the committed
`{ bucket, key, url, ... }`.

## Setup
- **Unit** (`*.spec.ts` under `libs/nestjs/src/lib/adapters/multer/`): a fake
  `OpenBucketService` with `jest.fn()` `uploadFrom` / `deleteObject`; drive
  `_handleFile` / `_removeFile` directly with a `Readable.from(...)` as `file.stream`
  and a fake `req`. Decorator tested against a mocked `ExecutionContext`.
- **E2E** (`libs/nestjs/**` or a test app under the e2e project): a real Nest app
  importing `OpenBucketModule.forRoot({ dataDir: <tmp>, rootCredentials, admin: false })`
  (headless) with a `FilesController` wiring `FileInterceptor('file', { storage:
  openBucketStorage(ob, ...) })`, `@UploadedToBucket()`, and
  `UploadValidationExceptionFilter`. Bucket `'uploads'` created in
  `onApplicationBootstrap`. Drive with `supertest` multipart POSTs. Assert
  persistence via `ob.headObject('uploads', key)`.
- Fixtures: a small PNG (magic-byte valid), an HTML file renamed `.png`
  (active-content), a > `maxBytes` random buffer, a multi-MB stream.

## Cases
1. **Valid single upload streams in.** Given a PNG POSTed to the wired route, when
   the handler runs, then `ob.headObject('uploads', <key>)` returns the object,
   `@UploadedToBucket()` yields `{ bucket:'uploads', key, url?, etag, size,
   contentType:'image/png' }`, and no temp file exists (spy on `fs` / assert
   `file.buffer` was never read — the engine used `file.stream`).
2. **No buffering / large stream.** Given a multi-MB body, when uploaded, then the
   object is committed and peak process memory does not grow by the file size
   (assert `uploadFrom` was called with a `Readable`, not a `Buffer`).
3. **Key strategy = 'uuid'.** Given `key: 'uuid'`, then the stored key matches
   `^\d{4}/[0-9a-f-]{36}\.png$` (the built-in shape) — proving `key` maps to
   `keyStrategy`, not the raw `opts.key`.
4. **Per-request key function is sanitized.** Given `key: () => '../../etc/passwd'`,
   when uploaded, then the request fails and nothing is committed
   (`assertSafeKey` rejects via the `keyStrategy`-function path); a valid function
   `() => 'tenants/a/report'` commits at exactly that key.
5. **Oversize → 400.** Given a body larger than `validate.maxBytes`, when uploaded
   with `UploadValidationExceptionFilter` installed, then the response is `400`
   with `{ code:'too_large' }` and `ob.headObject` finds **no** partial object.
6. **Active content → 400.** Given HTML bytes with filename `logo.png` and
   `allowedContentTypes:['image/*']`, then `400` with `code:'active_content'`
   (sniff beats the declared type); nothing committed.
7. **Disallowed type → 400.** Given a PDF with `allowedContentTypes:['image/*']`,
   then `400` with `code:'type_not_allowed'`.
8. **Multi-file rollback via `_removeFile`.** Given a `FilesInterceptor` request
   where file 1 is valid and file 2 violates `validate`, when the request fails,
   then `ob.deleteObject('uploads', <file1 key>)` was called and `headObject`
   confirms file 1 is gone (no orphan).
9. **`_removeFile` no-op when never committed.** Given a file whose `_handleFile`
   errored before commit, when `_removeFile` runs, then `deleteObject` is NOT
   called and the callback succeeds.
10. **`@UploadedToBucket()` array + empty.** Given `FilesInterceptor`, the decorator
    returns a `UploadedFileInfo[]`; given a request with no file part, it returns
    `undefined` (handler throws its own `BadRequestException`).
11. **S3 domain error passes through the filter.** Given `bucket: 'missing'` (not
    created), when uploaded, then `uploadFrom` throws `NoSuchBucketError` and the
    response is NOT a 400-from-`UploadValidationExceptionFilter` (it falls through
    to the default/host filter).
12. **Subpath export resolves.** The e2e app imports `openBucketStorage`,
    `UploadedToBucket`, `UploadValidationExceptionFilter` from
    `@openbucket/nestjs/multer` and compiles/boots — proving TASK-3603 wiring.
13. **No secret leakage.** Assert the 400 body and any captured logs from cases
    5–7 contain no credential, Authorization header, or signature value.

## Tooling
- Framework: jest | supertest
- Runner: `nx test nestjs` (unit specs) / `nx e2e nestjs-e2e` (round-trip app)

## Pass criteria
- [ ] Cases 1–13 pass.
- [ ] No temp file is created on the happy path (case 1).
- [ ] Every rejection (cases 5–7) commits no object and returns a 400 with a stable `code`.
- [ ] `assertSafeKey` blocks a traversal key (case 4).
- [ ] `_removeFile` rolls back exactly the committed objects (cases 8–9).
- [ ] The `@openbucket/nestjs/multer` subpath import resolves at build+runtime (case 12).

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` — `uploadFrom` (`:291`),
  `deleteObject` (`:488`), `headObject`, `UploadResult` (`:79`).
- `libs/nestjs/src/lib/open-bucket-upload.ts` — `UploadValidationError` codes,
  `assertSafeKey`, `resolveKey`.
- TASK-3600 / TASK-3601 / TASK-3602 / TASK-3603 implementation notes.
