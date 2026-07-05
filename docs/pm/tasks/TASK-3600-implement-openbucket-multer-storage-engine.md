---
id: TASK-3600
title: Implement the openBucketStorage multer StorageEngine
story: STORY-1200
status: backlog
type: implementation
size: M
---

## Description
Implement `openBucketStorage(ob, opts)`, a factory that returns a multer
`StorageEngine` (`_handleFile` / `_removeFile`) which streams each busboy part
straight through `OpenBucketService.uploadFrom` into OpenBucket — no temp files,
no full-body buffering. On success it merges the OpenBucket result onto the
multer file object so a param decorator can read it; on a later-part failure
`_removeFile` rolls back the already-committed object.

## Files to create / modify
- `libs/nestjs/src/lib/adapters/multer/open-bucket-storage.ts` — new (the engine + options type)
- `libs/nestjs/src/lib/adapters/multer/index.ts` — new (barrel, re-exports the engine)

## Implementation notes
- **Engine contract.** In a *custom* multer StorageEngine, `_handleFile(req, file, cb)`
  receives `file.stream` — the incoming busboy part as a `Readable`. Pass THAT to
  `uploadFrom` (which accepts `Readable` directly, `open-bucket.service.ts:291`);
  do NOT touch `file.buffer` (there is none for custom storage) so the body never
  buffers in memory and no temp file is written.
- **Options.** Resolve static-or-per-request forms:
  ```ts
  export interface OpenBucketStorageOptions {
    /** Destination bucket (static or derived per request/file). */
    bucket: string | ((req: Request, file: Express.Multer.File) => string);
    /** Built-in KeyStrategy, or a per-request key function. Default 'uuid'. */
    key?: KeyStrategy | ((req: Request, file: Express.Multer.File) => string | Promise<string>);
    /** Declarative validation (static or per-request). */
    validate?: UploadValidateOptions
      | ((req: Request, file: Express.Multer.File) => UploadValidateOptions);
    /** Probe image dimensions. Default: auto for image/* resolved types. */
    image?: boolean;
    /** Mint a GET url on the result (passed straight to uploadFrom). */
    presign?: PresignOptions | false;
  }
  export function openBucketStorage(
    ob: OpenBucketService,
    opts: OpenBucketStorageOptions,
  ): StorageEngine;
  ```
- **Key routing is the load-bearing security detail.** `uploadFrom` runs a custom
  `keyStrategy` FUNCTION through `assertSafeKey` (`open-bucket-upload.ts` `resolveKey`,
  `:267`), but it does **NOT** sanitize an explicit `opts.key` string
  (`open-bucket.service.ts:318`–`320` assigns it verbatim). Therefore map the
  adapter's `key` option to `uploadFrom`'s **`keyStrategy`**, never to `key`:
  - a `KeyStrategyName` string (`'uuid'` | `'sha256'` | …) → `keyStrategy: name`;
  - a per-request function → wrap as a `KeyStrategy` function
    `(ctx) => await userFn(req, file)` so the returned key is `assertSafeKey`-guarded.
  This closes path-traversal / control-char injection on caller-derived keys.
- **`_handleFile` sketch:**
  ```ts
  _handleFile(req, file, cb) {
    const bucket = typeof opts.bucket === 'function' ? opts.bucket(req, file) : opts.bucket;
    const validate = typeof opts.validate === 'function' ? opts.validate(req, file) : opts.validate;
    ob.uploadFrom(file.stream, {
      bucket,
      keyStrategy: toKeyStrategy(opts.key, req, file), // never `key:`
      validate,
      contentType: file.mimetype,      // declared hint; sniff still wins
      filename: file.originalname,     // hint for 'original' strategy / ext
      image: opts.image,
      presign: opts.presign,
    }).then((r) => cb(null, {
      // multer merges these onto `file`; `size` is a recognised field.
      size: r.size,
      openBucket: { bucket: r.bucket, key: r.key, url: r.url,
                    etag: r.etag, contentType: r.contentType,
                    versionId: r.versionId, image: r.image },
    })).catch((err) => {
      // Ensure the part stream is drained/destroyed so busboy doesn't stall.
      file.stream?.resume?.();
      cb(err); // UploadValidationError | S3 domain error — mapped by TASK-3602
    });
  }
  ```
- **`_removeFile` (rollback):**
  ```ts
  _removeFile(req, file, cb) {
    const ob2 = file.openBucket;
    if (!ob2?.key) return cb(null);         // never committed → nothing to remove
    ob.deleteObject(ob2.bucket, ob2.key)     // open-bucket.service.ts:488
      .then(() => cb(null))
      .catch((err) => cb(err));
  }
  ```
  multer calls `_removeFile` for each already-handled file when a *later* file in the
  same request errors — so a rejected 2nd file cleans up the committed 1st (no orphan).
- **Typing without a hard dep.** Import `StorageEngine` as a `type` from `multer`
  and `Request` from `express` (both peers). Guard the merged shape with a module
  augmentation or a local `OpenBucketMulterFile` interface exposing `openBucket`.
- **Edge cases / DoS.**
  - Unknown-length stream → `validate.maxBytes` is enforced by the writer's
    `maxSize` mid-write (`open-bucket-upload.ts` `assertValid` note, `:151`); pair
    it with multer's own `limits.fileSize` at the busboy layer for an early cut-off.
  - `bucket`/`key`/`validate` functions may throw — catch and forward to `cb(err)`.
  - `file.stream` absent (misuse: engine attached to a non-file field) → `cb` a
    clear `TypeError`.
  - Never log `req` headers, the resolved key, or credentials from the engine.

## Acceptance criteria
- [ ] `openBucketStorage(ob, { bucket: 'x' })` returns an object with callable
      `_handleFile` and `_removeFile` (a structural multer `StorageEngine`).
- [ ] A round-trip through `FileInterceptor` writes the object (a `headObject` on
      `file.openBucket.key` succeeds) and creates **no** temp file.
- [ ] A `key` function returning `../evil` throws (rejected by `assertSafeKey`),
      committing nothing.
- [ ] A body over `validate.maxBytes` is aborted and leaves no object.
- [ ] `_removeFile` deletes a committed object; a never-committed file is a no-op.
- [ ] `nx build nestjs` compiles with the new `multer`/`express` type-only imports.

## Test obligations
- Unit: covered by [TEST-1200] (engine `_handleFile`/`_removeFile` with a fake `ob`).
- E2E: covered by [TEST-1200] (real Nest app + `FileInterceptor` round-trip).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0803]

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` `:291` (`uploadFrom`), `:318`–`:320`
  (explicit-key path), `:488` (`deleteObject`).
- `libs/nestjs/src/lib/open-bucket-upload.ts` — `resolveKey` `:267`, `assertSafeKey`.
- multer custom StorageEngine contract (`_handleFile`/`_removeFile`, `file.stream`).
