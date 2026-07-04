---
id: TASK-2433
title: Add uploadFrom() one-call helper to OpenBucketService
story: STORY-0803
status: backlog
type: implementation
size: M
---

## Description
Add `OpenBucketService.uploadFrom(source, opts)` — the single entry point that ties
sniffing ([TASK-2430]), image metadata ([TASK-2431]), and validation + key strategies
([TASK-2432]) together, streams the body through the existing two-phase writer, and
returns `{ bucket, key, url?, etag, size, contentType, versionId?, image? }`. It
accepts a multer file, a `Readable`, or a `Buffer` and must not buffer a large stream
in memory.

## Files to create / modify
- `libs/nestjs/src/lib/open-bucket.service.ts` — modify. Add `uploadFrom` + the
  `UploadResult`/`UploadOptions` interfaces and a private `peekHead` stream helper.
- `libs/nestjs/src/lib/open-bucket.service.spec.ts` — new (or extend). Unit/integration tests.
- `libs/nestjs/src/index.ts` — modify (export `UploadOptions`, `UploadResult`).

## Implementation notes
- Signature:
  ```ts
  export type UploadSource = Buffer | Readable | Express.Multer.File;

  export interface UploadOptions {
    bucket: string;
    key?: string;                    // explicit key wins over keyStrategy
    keyStrategy?: KeyStrategy;       // default 'uuid'
    validate?: UploadValidateOptions;
    contentType?: string;            // declared hint (multer mimetype used if omitted)
    filename?: string;               // hint for 'original'/ext (multer originalname used if omitted)
    image?: boolean;                 // probe dimensions (default: auto for image/* types)
    presign?: PresignOptions | false;// mint a GET url; default: mint iff endpoint/baseUrl resolvable
  }

  export interface UploadResult {
    bucket: string; key: string; url?: string;
    etag: string; size: number; contentType: string;
    versionId?: string; image?: ImageInfo;
  }

  async uploadFrom(source: UploadSource, opts: UploadOptions): Promise<UploadResult>;
  ```
- Normalize `source`:
  - `Express.Multer.File` → `{ body: file.buffer ?? file.stream, declared: file.mimetype,
    filename: file.originalname, knownSize: file.size }`. (Support both memory-storage
    `buffer` and disk/stream storage.)
  - `Buffer` → body is the buffer, `knownSize = buffer.length`.
  - `Readable` → body is the stream, `knownSize` undefined.
- Head peek (bounded, no full-body buffering) — private helper:
  ```ts
  private async peekHead(body: Readable | Buffer, n: number)
    : Promise<{ head: Buffer; stream: Readable; knownEnd: boolean }>;
  ```
  - Buffer → `{ head: body.subarray(0, n), stream: Readable.from(body), knownEnd: true }`.
  - Readable → pull chunks via `body.iterator({ destroyOnReturn: false })` until `>= n`
    bytes or EOF, concat into `head`; rebuild the full stream with an async generator
    that yields the collected chunks then `yield*`s the remainder of the source:
    `Readable.from((async function*(){ yield* collected; yield* source; })())`.
    **Edge case:** the default async iterator destroys the stream on `break`; you MUST
    pass `{ destroyOnReturn: false }` or the tail is lost. On any peek error, destroy
    the source and rethrow.
- Flow inside `withContext` (reuse the private ORM-context wrapper already in the file):
  1. `peekHead(body, SNIFF_BYTES)`.
  2. `sniffed = sniffContentType(head)`.
  3. `resolvedType = resolveContentType(opts.contentType ?? multerMime, sniffed, mode)`.
  4. `image = (opts.image ?? resolvedType.startsWith('image/')) ? imageInfo(head) : undefined`.
  5. `assertValid(resolvedType, knownSize, validate)` — early reject before any write for
     known-size sources.
  6. Compute `maxSize = validate.maxBytes ?? config.maxObjectSizeMb * 1024*1024`; pass it
     to the writer so a **streamed** oversize body aborts mid-write and the staged blob is
     unlinked (`PutObjectCmd.maxSize`, TASK-2143) — the stream-path enforcement of the
     size cap `assertValid` cannot do without a length.
  7. Resolve a provisional key (`opts.key` or `resolveKey(strategy, ctx)`); for the
     `'sha256'` strategy, write to a temporary/computed key path OR (simpler) run the
     write first to obtain the digest, then `resolveKey` and, if the key differs, this is
     acceptable because the write already produced the etag — document that `'sha256'`
     performs the write then keys by digest (content-addressed, idempotent on repeat).
  8. Write via the domain seam: call `this.objects.putFromStream(bucket, key, stream, resolvedType)`
     (same path `putObject` uses) — but extend it / add an overload to accept `maxSize`
     and to return `size`, OR call `this.writer.put(...)` directly. Preferred: thread
     `maxSize` and `size` through a small addition to `ObjectService.putFromStream`
     (`putFromStream(bucket, key, body, contentType?, maxSize?)` returning
     `{ etag, versionId, size }`) to keep the facade off the writer internals.
  9. Build `url`: if `opts.presign !== false` and an origin is resolvable
     (`opts.presign?.baseUrl` or configured `endpoint`), `url = this.presignGetUrl(bucket, key, opts.presign ?? {})`;
     otherwise omit `url` (never emit a wrong/stale URL).
  10. Return `UploadResult`.
- Errors: `UploadValidationError` propagates to the caller (host maps to 400);
  `NoSuchBucketError` still thrown by the writer if the bucket is absent (unchanged).
- Security / DoS:
  - No full-stream buffering — only `SNIFF_BYTES` are ever held for a `Readable`.
  - Byte cap enforced two ways: pre-write for known sizes, mid-write via `maxSize` for streams.
  - Sniffed-over-declared type + active-content rejection preserved from [TASK-2432]
    (does not weaken the on-read `applySafeObjectResponseHeaders` guard — complements it).
  - Trust boundary unchanged: `uploadFrom`, like `putObject`, is the in-process host-app
    facade and sits *inside* the SigV4 + policy-evaluator perimeter (EPIC-08); it adds no
    network surface and is not rate-limited by `s3-throttle.ts` (that guards the wire path).
    Document in the JSDoc that host apps own request-level authz/limits for their own routes.

## Acceptance criteria
- [ ] `uploadFrom(multerFile, { bucket, keyStrategy: 'uuid' })` stores the object and
  returns `{ key, etag, size, contentType }` with the sniffed content type.
- [ ] Passing a `Readable` larger than `validate.maxBytes` rejects and leaves no committed
  object (writer `maxSize` abort verified — `headObject` returns null afterwards).
- [ ] A Buffer over `maxBytes` is rejected before any write (no staging file created).
- [ ] An `image/png` upload returns `image: { width, height, type: 'png' }`.
- [ ] A body sniffing as `text/html` is rejected with `UploadValidationError`.
- [ ] `url` is present when `presign: { baseUrl }` is given and omitted when no origin is
  resolvable.
- [ ] `nx test nestjs --testPathPattern=open-bucket.service` passes.

## Test obligations
- Unit + integration: covered by [TEST-0803] (uploadFrom case group).
- E2E: covered by [TEST-0803] (multer round-trip through a test Nest app).
- Conformance: N/A — in-process facade, not a wire operation.

## Dependencies
- Blocked by: [TASK-2430], [TASK-2431], [TASK-2432].

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` — `putObject`, `presignGetUrl`,
  `withContext`, `PutObjectResult`.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `putFromStream` (seam to extend).
- `libs/nestjs/src/lib/storage/object-writer.service.ts` — `PutObjectCmd.maxSize` (TASK-2143 cap).
- `libs/nestjs/src/lib/storage/content-sniff.ts`, `image-info.ts`, `open-bucket-upload.ts`
  from [TASK-2430]/[TASK-2431]/[TASK-2432].
