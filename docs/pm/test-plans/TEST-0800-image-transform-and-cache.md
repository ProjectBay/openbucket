---
id: TEST-0800
title: Image transform correctness, cache behavior, bounds/DoS, and authz parity
covers: [STORY-0800, TASK-2400, TASK-2401, TASK-2402, TASK-2403, TASK-2404]
status: backlog
level: integration
---

## Goal
Prove that GET-time image transforms produce correct derivatives, are served from a
content-addressed cache on repeat, are bounded against transform-bomb/disk-fill DoS,
pass through non-image and SVG content untouched, and enforce the exact same
`s3:GetObject` authz as a plain GET — with no bypass of the EPIC-08 posture.

## Setup
- In-memory SQLite + a temp `DATA_DIR` per the project unit/integration test
  conventions (as in `object.service.spec.ts` / `TEST-0703`).
- `SseKeyService` with a fixed 32-byte test key (to exercise the decrypted-source read
  path via `openObjectStream`).
- `AppConfigService` stub with small bounds so DoS caps are cheap to hit, e.g.
  `maxTransformDimension=1024`, `maxTransformInputBytes=1_048_576`,
  `transformLimitInputPixels=1_000_000`, `imageTransformConcurrency=2`,
  `derivativeCacheMaxBytes=64*1024`.
- Fixtures (generate with sharp at test time so no binary blobs are committed):
  - `pics/cat.jpg` — a real 800x600 JPEG (`image/jpeg`).
  - `pics/logo.png` — a 512x512 PNG with alpha.
  - `pics/bomb.png` — a physically tiny PNG that decodes to a canvas exceeding
    `transformLimitInputPixels` (highly compressible solid color at huge dimensions).
  - `pics/big.jpg` — a JPEG whose byte size exceeds `maxTransformInputBytes`.
  - `docs/diagram.svg` — an `image/svg+xml` object.
  - `docs/readme.txt` — a `text/plain` object.
  - `enc/secret.jpg` in a bucket with default `AES256` encryption (stored encrypted on
    disk) to prove transforms read decrypted plaintext.
- Seed each via the two-phase writer so ETags/encryption rows are real.

## Cases

1. **Basic resize + re-encode (TASK-2400/2402).** GET `pics/cat.jpg?w=200&h=200&fit=cover&format=webp&q=80`
   → `200`, `Content-Type: image/webp`; decode the body with sharp and assert
   `width===200 && height===200 && format==='webp'`; `ETag` matches `/^"[0-9a-f]{64}"$/`.

2. **Cache hit on repeat (TASK-2401/2402).** Spy/counter on the sharp pipeline. Issue
   case-1 request twice; assert the pipeline ran exactly once and both responses are
   byte-identical; assert a file exists at `derivatives/<h0h1>/<hash>.webp`.

3. **Cache key includes source ETag (TASK-2401).** After case 1, overwrite `pics/cat.jpg`
   with different bytes (new ETag), repeat the same transform URL → a **new** hash/ETag
   and a freshly produced derivative; the old file is not served.

4. **Width-only / native-format (TASK-2400/2402).** GET `pics/logo.png?w=100` (no format)
   → `200`, `Content-Type: image/png`, `width===100`, aspect ratio preserved, alpha kept.

5. **Param validation → 400, not 500 (TASK-2400).** Each of `?w=99999` (over
   `maxTransformDimension`), `?q=0`, `?q=101`, `?format=svg`, `?w=abc` → `400`
   `InvalidArgument`; assert no derivative file is written and sharp is never invoked.

6. **Input-byte guard (TASK-2402/2403).** GET `pics/big.jpg?w=100` → `400` (source over
   `maxTransformInputBytes`) before decode; process memory does not spike.

7. **Decompression-bomb guard (TASK-2402/2403).** GET `pics/bomb.png?w=100` → `400`
   (exceeds `transformLimitInputPixels`), not `500`/OOM; no cache entry written.

8. **SVG passthrough (TASK-2400/2402).** GET `docs/diagram.svg?w=100` → served by the
   normal `getObject` path: `Content-Type: application/octet-stream` +
   `Content-Disposition: attachment` + CSP (`applySafeObjectResponseHeaders`), body is
   the raw SVG bytes, and sharp is never invoked (no librsvg rendering).

9. **Non-image passthrough (TASK-2402).** GET `docs/readme.txt?w=100` → normal GET,
   `text/plain`, raw bytes, no transform.

10. **Encrypted source is transformed from plaintext (TASK-2402).** GET
    `enc/secret.jpg?w=64&format=png` → a valid 64px PNG decoded from the **plaintext**
    image (via `openObjectStream` decrypt), not from ciphertext bytes.

11. **Authz parity — explicit Deny (TASK-2402, EPIC-08 reuse).** With a bucket policy
    `Deny s3:GetObject` on `pics/*`, the transform URL `pics/cat.jpg?w=100` returns
    `403 AccessDenied` — identical to the plain GET — proving `PolicyAuthorizationGuard`
    still gates the request and the op resolves to `GetObject`.

12. **Authz parity — bad signature.** An unsigned/invalid-SigV4 transform request →
    `401/403` from `SigV4Guard`, no derivative produced.

13. **Single-flight coalescing (TASK-2401).** Fire N concurrent identical cold-cache
    transform requests; assert the pipeline ran exactly once and all N responses are
    byte-identical `200`s.

14. **Concurrency bound (TASK-2402/2403).** With `imageTransformConcurrency=2`, fire
    many distinct transforms and assert peak concurrent sharp invocations never exceeds 2.

15. **Config defaults + rejection (TASK-2403).** `loadEnv({})` yields the documented
    defaults; `MAX_TRANSFORM_DIMENSION=0` and `=999999` fail `loadEnv`;
    `IMAGE_TRANSFORM_ENABLED=false` → every transform URL falls through to plain GET.

16. **GC eviction to low-water mark (TASK-2404).** Populate the cache above
    `derivativeCacheMaxBytes` with distinct transforms; run `DerivativeCacheGcRunner.run()`
    once (Clock-driven); assert oldest-mtime entries are unlinked until total
    `<= 0.9 * max`, newer entries survive, and a subsequent hit on a surviving entry
    still serves correctly.

17. **GC no-ops (TASK-2404).** Under the cap → `run()` evicts nothing; `derivativeCacheMaxBytes=0`
    → `run()` short-circuits; a missing `derivatives/` dir → `run()` does not throw.

## Tooling
- Framework: jest + supertest (real GET route for the E2E-style cases), `sharp` to
  build fixtures and decode/assert response bodies, `@aws-sdk/client-s3` or a raw
  signed request helper for the SigV4/authz cases.
- Runner: `nx test nestjs` (unit + integration specs), `nx e2e nestjs-e2e` for the
  route-level authz/passthrough cases if present.

## Pass criteria
- [ ] All cases 1–17 pass.
- [ ] No transform request produces a `500` for attacker-controlled input (bad params,
      oversized source, decompression bomb all yield `400`).
- [ ] No case observes a derivative served across a source-ETag change (case 3) or
      without passing GET authz (cases 11–12).
- [ ] The cache remains `<= DERIVATIVE_CACHE_MAX_BYTES` after GC (case 16).

## References
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts:85`,
  `libs/nestjs/src/lib/domain/objects/object.service.ts:304` (`openObjectStream`), `:438` (`getObject`), `:74`.
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`, `s3/routing/operation-resolver.ts:113`.
- `libs/nestjs/src/lib/common/background/trash-purge.runner.ts`, `common/config/env.schema.ts`.
- Pattern reference: `docs/pm/test-plans/TEST-0703-copyobject-sse-roundtrip-and-key-model.md`.
</content>
