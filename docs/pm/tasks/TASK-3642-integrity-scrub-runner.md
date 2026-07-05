---
id: TASK-3642
title: Implement the throttled IntegrityScrubRunner background tick
story: STORY-1204
status: backlog
type: implementation
size: L
---

## Description
Add the background runner that walks current/local objects on the §4.9 tick, re-verifies
each blob via `IntegrityVerifier`, and persists the verdict — strictly rate-limited so it
never starves request traffic. This is the core detection loop (repair is TASK-3643). It
follows the `TieringSweepRunner` / `ReconcileRunner` throttling shape exactly.

## Files to create / modify
- `libs/nestjs/src/lib/common/background/integrity-scrub.runner.ts` — new (`ScheduledTask`)
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify (providers + `SCHEDULED_TASKS` inject list)
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (config knobs)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify (typed getters)
- `libs/nestjs/src/lib/persistence/entities/scrub-state.entity.ts` — new (single-row cursor + counters)
- `libs/nestjs/src/lib/migrations/Migration20260716000002_scrub_state.ts` — new

## Implementation notes
- Class shape mirrors `TieringSweepRunner`:
  ```ts
  export const INTEGRITY_SCRUB_BATCH_SIZE = 200;
  export const INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK = 1000; // hard per-tick object cap
  @Injectable()
  export class IntegrityScrubRunner implements ScheduledTask {
    readonly name = 'integrity-scrub';
    readonly intervalMs = this.config.integrityScrubIntervalMs; // default 60_000
    async run(): Promise<void> { /* default-off gate, batched cursor walk */ }
  }
  ```
- Default-off gate (first line of `run()`, mirrors `tiering-sweep`): `if (!this.config.integrityScrubEnabled) return;` — a fresh install performs zero disk reads / DB writes.
- Throttle (this is the "low-priority, never starves traffic" requirement — cite the
  `TieringSweepRunner` batch loop):
  - Page `scanForScrub({ afterBucket, afterKey, limit: INTEGRITY_SCRUB_BATCH_SIZE })`.
  - Track `objectsThisTick` and `bytesThisTick`; stop the tick when either
    `objectsThisTick >= INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK` or
    `bytesThisTick >= config.integrityScrubMaxBytesPerTick` — persist the cursor and return.
  - `await new Promise((r) => setImmediate(r))` between batches so request handlers interleave
    (identical to `tiering-sweep.runner.ts:112` and `reconcile.runner.ts:146`).
  - The scheduler's own no-pile-up guard (`background.service.ts` `fire()`) means a slow tick
    is skipped, never queued.
- Per-object step:
  ```ts
  const res = await this.verifier.verify(o.bucket.name, o.key, o.contentSha256!, { encryption: o.encryption });
  bytesThisTick += res.bytesHashed;
  const status = res.ok ? IntegrityStatus.Ok : IntegrityStatus.Corrupt;
  // nativeUpdate — cheap, no identity-map churn across a long walk
  await this.em.nativeUpdate(ObjectEntity,
    { bucket: { name: o.bucket.name }, key: o.key },
    { integrityStatus: status, integrityCheckedAt: new Date(),
      integrityDetail: res.ok ? null : this.redact(`sha ${res.actualSha256} != ${o.contentSha256}`) });
  if (!res.ok) { this.log.error(`CORRUPT ${o.bucket.name}/${o.key}`); /* hand to repair in TASK-3643 */ }
  ```
- `scrub-state` entity: a single well-known row (id `'default'`) holding `cursorBucket`,
  `cursorKey`, `lastRunAt`, and lifetime counters (`scanned`, `corruptFound`, `repaired`) so
  the admin `status` endpoint reads durable numbers. When `scanForScrub` returns empty, reset
  the cursor to null (full pass complete) and stamp `lastRunAt`.
- Config knobs (`env.schema.ts`, follow the `envBoolean` / `z.coerce.number` pattern used by
  `USAGE_ROLLUP_INTERVAL_MS` and `OB_REPLICATION_ENABLED`):
  - `OB_INTEGRITY_SCRUB_ENABLED` → `envBoolean(false)`
  - `OB_INTEGRITY_SCRUB_INTERVAL_MS` → `z.coerce.number().int().min(1_000).default(60_000)`
  - `OB_INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK` → `z.coerce.number().int().min(1).default(1000)`
  - `OB_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK` → `z.coerce.number().int().positive().default(1_073_741_824)` (1 GiB/tick throttle)
- Registration: add `IntegrityScrubRunner` BOTH to `providers` and to the `SCHEDULED_TASKS`
  factory `inject` array in `background.module.ts` (NestJS has no `multi` flag — see the
  module's own doc comment).
- Edge cases / resilience (mirror `tiering-sweep` per-object isolation):
  - ENOENT (blob deleted mid-walk) → leave `unchecked`, log debug, advance cursor — NOT corrupt.
  - Object concurrently overwritten (its `contentSha256` changed) → the stale hash simply
    fails to match; re-read the row's current `contentSha256` inside a short transaction before
    marking corrupt, or skip if `modifiedAt` advanced past scan time (avoid false positives).
  - The cursor ALWAYS advances so one poisoned key can't wedge the walk.
- Security/DoS: no endpoint/credential is ever logged (`integrityDetail` is passed through a
  `redact()` helper modelled on `reconcile.runner.ts` `redactError` — strips URLs and the
  configured target coordinates, bounded to 255). The byte budget bounds disk read amplification.

## Acceptance criteria
- [ ] With `OB_INTEGRITY_SCRUB_ENABLED` unset, `run()` returns before any repository/blob access (asserted via mocks).
- [ ] A tick hashing enough to hit `MAX_OBJECTS_PER_TICK` or `MAX_BYTES_PER_TICK` persists the cursor and stops; the next tick resumes from it.
- [ ] A blob whose bytes are flipped on disk is marked `integrityStatus='corrupt'` with `integrityCheckedAt` set; an intact blob is marked `ok`.
- [ ] `IntegrityScrubRunner` appears in `background.module.ts` providers and the `SCHEDULED_TASKS` inject list; `nx test nestjs --testPathPattern=integrity-scrub.runner` passes.

## Test obligations
- Unit: covered by [TEST-1204] (default-off, throttle/cursor, corrupt detection, ENOENT isolation)
- E2E: covered by [TEST-1204] (enable scrub, corrupt a blob, observe status flip)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3640], [TASK-3641]
