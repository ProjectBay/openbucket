---
id: TASK-2713
title: Add tiering configuration knobs and background/storage module wiring
story: STORY-0901
status: backlog
type: infra
size: S
---

## Description

Introduce the environment knobs that gate and bound tiering, and wire the new
providers into the module graph so the sweep runner and rehydration seam receive
their dependencies. Tiering stays off unless explicitly enabled *and* a STORY-0900
remote target is configured — a fresh single-node install behaves exactly as today.

## Files to create / modify

- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (add `OPENBUCKET_TIER_*`)
- `libs/nestjs/src/lib/common/config/env.schema.spec.ts` — modify (defaults + bounds)
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify (register
  `TieringSweepRunner` in `providers` **and** the `SCHEDULED_TASKS` factory `inject`)
- `libs/nestjs/src/lib/domain/domain.module.ts` — modify (provide/export
  `TieringService`)
- `libs/nestjs/src/lib/domain/tiering/tiering.module.ts` — new (optional grouping
  module if `TieringService` + its `RemoteObjectStore` dep warrant one)

## Implementation notes

- Add to `EnvSchema` (match existing coercion/bounds/comment style):
  ```ts
  // --- cold-object tiering (STORY-0901) ---
  // Master switch; still a no-op unless a STORY-0900 remote target is configured.
  OPENBUCKET_TIER_ENABLED: z.coerce.boolean().default(false),
  // Read-through: objects at/under this size are proxied; larger ⇒ presigned redirect.
  OPENBUCKET_TIER_INLINE_MAX_BYTES: z.coerce.number().int().nonnegative()
    .default(256 * 1024 * 1024), // 256 MiB
  // Hard latency bound on a proxied remote fetch before returning 503 SlowDown.
  OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS: z.coerce.number().int().positive()
    .default(30_000),
  // Global cap on concurrent rehydrations (disk + egress amplifier). 0 = unlimited.
  OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE: z.coerce.number().int().nonnegative()
    .default(8),
  // TTL for presigned redirect URLs.
  OPENBUCKET_TIER_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600)
    .default(300),
  ```
  Keep `z.object` strip-unknown behaviour (see the schema's trailing note) — do
  not switch to `.strict()`.
- `RemoteObjectStore` is provided by STORY-0900. This Story consumes it via
  constructor injection with `@Optional()`; when absent (no target configured),
  `TieringService` reports "disabled" and `TieringSweepRunner.run()` early-returns.
  This is the same `@Optional()` pattern `BlobStore` uses for `FreeSpaceService`.
- `background.module.ts`: NestJS has no `multi` provider flag — the `SCHEDULED_TASKS`
  factory returns `(...tasks) => tasks` and each runner must be added to **both**
  the `providers` array and the factory's `inject` list (the module's own doc
  comment says so). Add `TieringSweepRunner` to both.
- Edge cases / security: gating on both `OPENBUCKET_TIER_ENABLED` and remote
  presence prevents surprise data movement. Bounding knobs
  (`INLINE_MAX_BYTES`, `MAX_CONCURRENT_REHYDRATE`, `READTHROUGH_TIMEOUT_MS`) are the
  DoS envelope for TASK-2712 and default to safe, conservative values. The presign
  TTL is capped at 1h so a leaked redirect URL is short-lived.

## Acceptance criteria

- [ ] `nx test nestjs --testPathPattern=env.schema.spec` passes: new keys parse
      with defaults and reject out-of-range values.
- [ ] `nx test nestjs --testPathPattern=background.module` (module compiles):
      `SCHEDULED_TASKS` resolves to an array including the tiering runner.
- [ ] With `OPENBUCKET_TIER_ENABLED=false` (default) no tiering provider performs
      any remote or FS mutation.

## Test obligations

- Unit: covered by [TEST-0901] (config + wiring cases)
- E2E: N/A — pure infra/config
- Conformance: N/A

## Dependencies

- Blocked by: [STORY-0900]; enables [TASK-2711], [TASK-2712]
