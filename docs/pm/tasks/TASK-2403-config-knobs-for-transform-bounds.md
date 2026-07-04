---
id: TASK-2403
title: Add config knobs for transform bounds and cache size
story: STORY-0800
status: backlog
type: infra
size: S
---

## Description
Add the environment knobs that bound the transform feature and the derivative
cache, following the existing `env.schema.ts` + `AppConfigService` pattern (typed
getters, safe defaults, zod validation at boot). These caps are the operator-facing
half of the DoS story: every attacker-controllable resource has a default ceiling
that an operator can tune but that is never unbounded.

## Files to create / modify
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify: add the keys below to
  `EnvSchema` with defaults.
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify: add matching
  typed getters.
- `libs/nestjs/src/lib/common/config/env.schema.spec.ts` (or the existing config
  spec) — modify/new: assert defaults + coercion + rejection of out-of-range values.

## Implementation notes
- New keys (all `z.coerce.number()` like the existing `limits` block at
  `env.schema.ts:84-100`), grouped under a new `// --- image transforms ---` comment:
  ```ts
  IMAGE_TRANSFORM_ENABLED: z.coerce.boolean().default(true),
  // Hard ceiling on requested output width/height (px). Bounds the output canvas.
  MAX_TRANSFORM_DIMENSION: z.coerce.number().int().positive().max(16_384).default(4_096),
  // Refuse to transform a source larger than this (bytes) — pre-decode guard.
  MAX_TRANSFORM_INPUT_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024), // 50 MiB
  // sharp limitInputPixels — decoded-canvas ceiling (decompression-bomb guard).
  IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS: z.coerce.number().int().positive().default(24_000 * 24_000),
  // Max concurrent sharp operations in-flight (CPU/RAM governor).
  IMAGE_TRANSFORM_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),
  // Derivative cache size ceiling (bytes); GC tick evicts LRU past this. 0 = unbounded (discouraged).
  DERIVATIVE_CACHE_MAX_BYTES: z.coerce.number().int().nonnegative().default(5 * 1024 * 1024 * 1024), // 5 GiB
  ```
- Getters on `AppConfigService` (mirror the one-liners at `app-config.service.ts:29-44`):
  `imageTransformEnabled`, `maxTransformDimension`, `maxTransformInputBytes`,
  `transformLimitInputPixels`, `imageTransformConcurrency`, `derivativeCacheMaxBytes`.
- `IMAGE_TRANSFORM_ENABLED=false` makes `ImageTransformService.isCandidate` return
  `false` so every GET falls through to the plain path (feature kill-switch — an
  operator who does not want the CPU exposure can disable it wholesale).
- Note in the `env.schema.ts` header comment block is unnecessary; keep the existing
  strip-unknown-keys behaviour (process.env carries unrelated OS vars — see the note
  at `env.schema.ts:121`).
- Edge cases: `MAX_TRANSFORM_DIMENSION` capped at 16384 so an operator cannot
  accidentally set an unbounded value; `DERIVATIVE_CACHE_MAX_BYTES=0` explicitly
  allowed but documented as discouraged.

## Acceptance criteria
- [ ] Booting with none of the new vars set yields the documented defaults via
      `AppConfigService` getters.
- [ ] `MAX_TRANSFORM_DIMENSION=0` or `=999999` is rejected at boot (fails `loadEnv`).
- [ ] `IMAGE_TRANSFORM_ENABLED=false` is coerced to a boolean `false`.
- [ ] `nx test nestjs --testPathPattern=env.schema` (or the config spec) passes.

## Test obligations
- Unit: covered by [TEST-0800] (schema defaults, coercion, out-of-range rejection)
- E2E: N/A — pure config
- Conformance: N/A

## Dependencies
- Blocked by: _none_ (may land first; TASK-2400/2402/2404 consume these getters)

## References
- `libs/nestjs/src/lib/common/config/env.schema.ts:84-119` (limits/quota/throttle block).
- `libs/nestjs/src/lib/common/config/app-config.service.ts:29-44` (typed getters).
</content>
