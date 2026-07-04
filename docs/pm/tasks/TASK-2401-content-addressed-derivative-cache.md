---
id: TASK-2401
title: Content-addressed derivative cache store with atomic writes and single-flight
story: STORY-0800
status: backlog
type: implementation
size: M
---

## Description
Add a `DerivativeCacheService` in the storage layer that persists transformed
image bytes in a content-addressed store under `DATA_DIR/derivatives/`, keyed on a
hash of the source ETag plus the normalized transform params. It provides `get`
(stat + open read stream), `put` (atomic two-phase write mirroring `BlobStore`),
and a single-flight guard so a thundering herd on a cold entry runs the (expensive)
transform once. Because the key embeds the source ETag, a source overwrite
naturally yields a new key — stale entries are simply orphaned and reclaimed by the
GC tick (TASK-2404), so there is no cache-invalidation race.

## Files to create / modify
- `libs/nestjs/src/lib/storage/paths.ts` — modify `PathResolver`: add
  `derivativesDir()` and `derivativePath(hash: string, ext: string)` (fan-out by the
  first 2 hex chars of `hash` to avoid a single mega-directory).
- `libs/nestjs/src/lib/storage/derivative-cache.service.ts` — new: the service.
- `libs/nestjs/src/lib/storage/derivative-cache.service.spec.ts` — new: unit tests.
- `libs/nestjs/src/lib/storage/storage.module.ts` — modify: add
  `DerivativeCacheService` to `providers` and `exports` (so both `S3Module` and
  `BackgroundModule`, which already import `StorageModule`, can inject it).

## Implementation notes
- Cache key (content-addressed, deterministic, collision-resistant):
  ```ts
  static cacheKey(sourceEtag: string, p: TransformParams): string {
    const canonical = `${sourceEtag}|w=${p.width ?? ''}|h=${p.height ?? ''}` +
      `|fit=${p.fit}|fmt=${p.format ?? ''}|q=${p.quality}`;
    return createHash('sha256').update(canonical).digest('hex'); // 64 hex chars
  }
  ```
  The hash is also the response `ETag`. Do **not** include the client-supplied
  key/bucket in the hash — identical source+params dedupe across keys, and the hash
  is never client-addressable (only produced server-side), so it is not an
  enumeration oracle.
- Paths: `derivativePath(hash, ext)` → `join(derivativesDir(), hash.slice(0,2), hash + '.' + ext)`.
  Build `PathResolver` from `config.getOrThrow('DATA_DIR')` exactly as `BlobStore`
  does (`blob-store.ts:66`), or inject `BlobStore` and reuse `blobs.paths` — prefer
  a private `PathResolver` to keep the dependency direction clean.
- `put(hash, ext, bytes)`: stage to `paths.tmpPath('deriv-' + randomUUID())`, write,
  `fsync`, `atomicRename` into place, `fsyncDir` — the same durability recipe as
  `BlobStore.putBlob` (`blob-store.ts:99-136`). Reuse `MaxBlobSizeExceededError`
  semantics is unnecessary here (input is already an in-memory Buffer bounded by
  the transform stage).
- `get(hash, ext)`: `fs.stat` then `createReadStream`; return `{ stream, size } | null`
  (null on ENOENT) so the transform service can decide hit vs. miss.
- Single-flight: `private inFlight = new Map<string, Promise<CacheEntry>>()`.
  `getOrCreate(hash, ext, produce)` returns an existing in-flight promise if present,
  else stores one that (a) rechecks disk, (b) runs `produce()`, (c) `put`s, (d)
  deletes the map entry in `finally`. This bounds duplicate work under a cold-cache
  burst without a cross-process lock (single Node process — matches the whole-app
  concurrency model in `s3/CONCURRENCY.md`).
- Security/DoS: the store is under `DATA_DIR` and subject to the same
  `FreeSpaceService` reserve as blobs is out of scope here (writes are small and
  GC-bounded), but the GC tick (TASK-2404) enforces `DERIVATIVE_CACHE_MAX_BYTES` so
  the cache cannot fill the disk. Filenames are hex-only (from a hash) — no
  path-traversal from user input, unlike raw keys which go through `key-codec`.
- Edge cases: concurrent `put` of the same hash → last-rename-wins (idempotent, both
  bytes identical); a torn write is impossible (tmp→rename); ENOENT on read → miss.

## Acceptance criteria
- [ ] `cacheKey(etag, params)` is stable for identical inputs and differs when any
      param or the source ETag changes.
- [ ] `put` then `get` returns a stream whose bytes equal the written bytes; the file
      lands at `derivatives/<h0h1>/<hash>.<ext>` via an atomic rename (no partial file
      is ever observable).
- [ ] Two concurrent `getOrCreate` calls for the same hash invoke `produce` exactly
      once (single-flight assertion).
- [ ] `get` on an absent hash returns `null`, not a throw.
- [ ] `nx test nestjs --testPathPattern=derivative-cache` passes.

## Test obligations
- Unit: covered by [TEST-0800] (key stability, atomic put/get, single-flight)
- E2E: covered by [TEST-0800] (repeat GET is a cache hit)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2400] (consumes `TransformParams`)

## References
- `libs/nestjs/src/lib/storage/blob-store.ts:99-136` (two-phase tmp→fsync→rename),
  `:66` (`PathResolver` from `DATA_DIR`).
- `libs/nestjs/src/lib/storage/paths.ts` (path builders).
- `libs/nestjs/src/lib/s3/CONCURRENCY.md` (single-process concurrency model).
</content>
