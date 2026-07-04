---
id: TASK-2402
title: Image transform service and GET-path dispatch with DoS bounds
story: STORY-0800
status: backlog
type: implementation
size: L
---

## Description
Add `ImageTransformService` — the sharp pipeline that reads the decrypted source,
resizes/re-encodes it under strict resource bounds, and serves the result via
`DerivativeCacheService` — and wire it into `ObjectController.get` so a transform
request is intercepted before the plain `getObject` path, with a clean passthrough
for everything else. This Task realizes the core Story behavior and carries the
bulk of the transform-bomb DoS mitigations.

## Files to create / modify
- `libs/nestjs/src/lib/s3/transforms/image-transform.service.ts` — new: the service.
- `libs/nestjs/src/lib/s3/transforms/image-transform.service.spec.ts` — new.
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts` — modify `get()`
  (`:85`): after the sub-resource checks, before `return this.objects.getObject(...)`,
  add `if (this.transforms.isCandidate(q)) return this.transforms.get(req, res, bucket, key);`
  and inject `ImageTransformService` in the constructor.
- `libs/nestjs/src/lib/s3/s3.module.ts` — modify: add `ImageTransformService` to
  `providers` (module already imports `DomainModule` + `StorageModule`).

## Implementation notes
- Entry `get(req, res, bucket, key)`:
  1. Resolve the current version's decrypted source via
     `ObjectService.openObjectStream(bucket, key)` (`object.service.ts:304`) — it
     returns `{ stream, size, contentType, etag }` already SSE-decrypted, so the
     transform never re-implements the cipher path. `null` → `NoSuchKeyError`.
  2. **Passthrough gate**: if `!isTransformableContentType(contentType)`, destroy the
     probe stream and delegate to `this.objects.getObject(req, res, bucket, key)` —
     non-image and `image/svg+xml` objects are served verbatim (with the existing
     `applySafeObjectResponseHeaders` neutralization). This keeps SVG/HTML inert.
  3. `parseTransformParams(req.query, config.maxTransformDimension)` → 400 on bad input.
  4. **Input-size guard**: if `size > config.maxTransformInputBytes` → `400
     InvalidArgument` ("source too large to transform"). Do this before buffering.
  5. Cache: `hash = DerivativeCacheService.cacheKey(etag, params)`,
     `ext = params.format ?? sourceExtFrom(contentType)`. `getOrCreate(hash, ext, produce)`.
  6. `produce()` = read the source stream into a Buffer bounded by
     `maxTransformInputBytes` (abort the stream past the cap, like
     `blob-store.ts:122`), then run the pipeline under the concurrency semaphore.
- Sharp pipeline (bounded):
  ```ts
  const out = await this.semaphore.run(() =>
    sharp(input, { limitInputPixels: this.config.transformLimitInputPixels, failOn: 'none' })
      .rotate()                                   // honour EXIF orientation
      .resize({ width: p.width, height: p.height, fit: p.fit, withoutEnlargement: true })
      .toFormat(p.format ?? nativeFormat, { quality: p.quality })
      .toBuffer(),
  );
  ```
  `limitInputPixels` makes a decompression bomb (tiny file, huge canvas) throw
  instead of allocating; map that throw to `400`. `withoutEnlargement: true` avoids
  upscaling a small source into a large buffer. `failOn: 'none'` keeps a slightly
  corrupt but decodable image from 500-ing.
- Concurrency semaphore: a tiny counting semaphore sized `IMAGE_TRANSFORM_CONCURRENCY`
  (TASK-2403). sharp is CPU+RAM heavy; unbounded parallel decodes are the real DoS,
  so cap in-flight transforms and let the rest await. Combined with single-flight
  (TASK-2401) and the `S3_THROTTLE` per-IP bucket (`env.schema.ts:105`), a flood is
  bounded at three layers.
- Response: on hit or after produce, stream the cache file. Set:
  `res.setHeader('Content-Type', FORMAT_MIME[fmt])`, `Content-Length` from stat,
  `ETag`: `"<hash>"`, `Cache-Control: public, max-age=31536000, immutable` (the URL is
  content-addressed via the source ETag), `X-Content-Type-Options: nosniff`. Emit
  `Accept-Ranges: none` — transforms are served whole; a `Range` header on a
  transform is ignored (return full `200`, documented). Honour `If-None-Match` against
  the derivative ETag → `304`.
- Authz is unchanged and MUST NOT be touched: the request already passed
  `SigV4Guard` + `PolicyAuthorizationGuard` for `s3:GetObject` (the op resolver
  returns `GetObject` for these params, `operation-resolver.ts:113`). The service is
  invoked from inside the guarded handler, so there is no new authorization path and
  no way to read a derivative without passing the same GET authz.
- Edge cases: source deleted between authz and read → `NoSuchKeyError`; `format`
  omitted → re-encode in the source's native format at the requested size; animated
  GIF/large TIFF still bounded by `limitInputPixels` + input-byte cap; a `sharp`
  failure never leaks a partial response (produce runs before any header is sent).
- Do not regress `getObject`: only intercept when `isCandidate(q)` (delegates to
  `isTransformRequest`); every other GET reaches `this.objects.getObject` untouched.

## Acceptance criteria
- [ ] `GET /photos/cat.jpg?w=200&h=200&fit=cover&format=webp` returns `200`,
      `Content-Type: image/webp`, a decodable 200x200 WebP, and `ETag: "<64hex>"`.
- [ ] A second identical request is a cache hit (no second `sharp` call — assert via a
      spy/counter) and returns byte-identical bytes.
- [ ] A non-image object and an `image/svg+xml` object with `?w=100` are served by the
      normal `getObject` path (attachment/CSP-neutralized), not transformed.
- [ ] A tiny crafted image that decodes past `transformLimitInputPixels`, and a source
      over `maxTransformInputBytes`, each return `400`, not `500` or OOM.
- [ ] A `Deny s3:GetObject` policy returns `403` for the transform URL (authz parity).
- [ ] `nx test nestjs --testPathPattern=image-transform` passes.

## Test obligations
- Unit: covered by [TEST-0800] (pipeline output, passthrough, bounds, semaphore)
- E2E: covered by [TEST-0800] (real GET route: transform, cache hit, 400s, 403 authz)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2400], [TASK-2401], [TASK-2403]

## References
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts:85` (dispatch site).
- `libs/nestjs/src/lib/domain/objects/object.service.ts:304` (`openObjectStream`),
  `:438` (`getObject` passthrough), `:74` (`applySafeObjectResponseHeaders`), `:122` of
  `blob-store.ts` (stream byte-cap abort pattern).
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts` (unchanged authz).
- sharp: https://sharp.pixelplumbing.com/api-resize , https://sharp.pixelplumbing.com/api-constructor
</content>
