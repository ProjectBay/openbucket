---
id: STORY-0800
title: On-the-fly image transformations + derivative cache
epic: EPIC-09
status: backlog
size: L
risk: medium
---

## User story
As an app developer embedding `@openbucket/nestjs` (or running the standalone server) to store user-uploaded images, I want `GET /:bucket/:key?w=&h=&fit=&format=&q=` to return a resized/re-encoded derivative served from a content-addressed cache, so that I can render responsive thumbnails and modern formats straight from OpenBucket without standing up a separate image service — and without exposing a transform-bomb DoS.

## Description
This Story adds GET-time image transformation to the S3 object read path. When an image object is requested with transform query params, the service resizes/re-encodes it with `sharp`, stores the result in a content-addressed derivative cache keyed on the source ETag plus the normalized params, and streams it back; a repeat request is a cheap cache hit. Parameters are bounded and validated (max dimensions, output-format allow-list, quality clamp, input-pixel and input-byte caps, a concurrency semaphore, single-flight coalescing) so a small crafted source or a request flood cannot exhaust CPU/RAM/disk. Transforms apply **only** to allow-listed raster image content-types; every other object, and every request with no transform params, falls through to the existing `ObjectService.getObject` path unchanged. Access control is unchanged: the request is still `s3:GetObject` (`operation-resolver.ts` returns `GetObject` for these params), so `SigV4Guard` + `PolicyAuthorizationGuard` gate it exactly as a normal GET, and the derivative cache is an internal-only store never addressable by clients.

## Acceptance criteria
- [ ] `GET /photos/cat.jpg?w=200&h=200&fit=cover&format=webp&q=80` on a JPEG object returns `200` with `Content-Type: image/webp`, a `200x200` (cover-cropped) WebP body, and a strong quoted `ETag` derived from the derivative hash.
- [ ] The identical request repeated is served from the on-disk derivative cache without re-invoking `sharp` (verified by a cache-hit counter / no second decode), and returns byte-identical bytes.
- [ ] Overwriting the source object (new source ETag) causes the next transform request to produce and cache a **new** derivative; the stale entry is never served (source ETag is part of the cache key) and is later reclaimed by the GC tick.
- [ ] A request whose `w` or `h` exceeds `MAX_TRANSFORM_DIMENSION`, whose `format` is not in the allow-list (`webp|jpeg|png|avif`), or whose `q` is out of `1..100` is rejected with `400 InvalidArgument` before any decode; `image/svg+xml` and non-image content-types are **not** transformed (passthrough), closing the librsvg / active-content surface.
- [ ] A source object larger than `MAX_TRANSFORM_INPUT_BYTES`, or one that decodes past `sharp`'s `limitInputPixels`, is refused with `400` (decompression-bomb guard) rather than buffering/rendering an oversized canvas.
- [ ] No transform request bypasses authz: a `Deny s3:GetObject` bucket policy (or a failing SigV4 signature) yields `403`/`401` for the transform URL exactly as for the plain GET, and no derivative path is client-addressable.
- [ ] Concurrent identical cold-cache requests coalesce (single-flight) so `sharp` runs once; concurrent distinct transforms are bounded by `IMAGE_TRANSFORM_CONCURRENCY`.
- [ ] The derivative cache is size-bounded: a background tick evicts entries (LRU by mtime) so the store never exceeds `DERIVATIVE_CACHE_MAX_BYTES`.

## Tasks
- [TASK-2400] Add sharp dependency and transform-param parsing/validation
- [TASK-2401] Content-addressed derivative cache store with atomic writes and single-flight
- [TASK-2402] Image transform service and GET-path dispatch with DoS bounds
- [TASK-2403] Config knobs for transform bounds and cache size
- [TASK-2404] Derivative-cache GC background tick and eviction

## Test plan
- [TEST-0800] Image transform correctness, cache behavior, bounds/DoS, and authz parity

## Dependencies
- Blocks: [STORY-0803] (the `OpenBucketService` image DX helpers reuse the transform + metadata primitives produced here)
- Blocked by: _none_ — builds on the existing object read path. Reuses (does not modify) the EPIC-08 authz posture: [STORY-0700]/[TASK-2120] `PolicyAuthorizationGuard`, the SigV4 chain, and the [TASK-2141] `S3_THROTTLE` per-IP bucket already cover the transform URL because it is a plain `GetObject`.

## References
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts:85` (`@Get('*') get()` dispatch — where transform dispatch is added).
- `libs/nestjs/src/lib/domain/objects/object.service.ts:438` (`getObject`, the passthrough target), `:304` (`openObjectStream`, returns the decrypted source stream + `etag`/`contentType`/`size` reused as the transform input + cache-key source), `:74` (`applySafeObjectResponseHeaders`).
- `libs/nestjs/src/lib/s3/routing/operation-resolver.ts:113` (GET with transform params still resolves to `GetObject`, so `operation-action.ts` maps `s3:GetObject`).
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`, `s3/authz/policy-evaluator.ts` (unchanged authz reused verbatim).
- `libs/nestjs/src/lib/storage/blob-store.ts` (two-phase tmp→fsync→rename pattern the cache write mirrors), `storage/paths.ts` (new `derivativesDir`/`derivativePath`), `storage/key-codec.ts`.
- `libs/nestjs/src/lib/common/background/background.service.ts` (`ScheduledTask`), `common/background/trash-purge.runner.ts` (GC runner pattern), `common/background/background.module.ts` (wiring).
- `libs/nestjs/src/lib/common/config/env.schema.ts`, `common/config/app-config.service.ts` (new bounds/config knobs).
- New dependency: `sharp` (libvips image processing) in `libs/nestjs/package.json`.
</content>
</invoke>
