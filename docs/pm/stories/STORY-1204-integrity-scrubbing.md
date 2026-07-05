---
id: STORY-1204
title: Integrity scrubbing (bit-rot detection & repair)
epic: EPIC-13
status: backlog
size: L
risk: medium
---

## User story
As an operator, I want OpenBucket to continuously re-verify stored blobs against their
recorded SHA-256 in the background and repair any corruption from a replication target,
so that silent bit-rot on the DATA_DIR filesystem is detected and healed before a client
ever reads bad bytes — without the scrub starving live request traffic.

## Description
Adds a low-priority background scrubber (`IntegrityScrubRunner`) that walks current,
local objects on the §4.9 tick, re-computes each blob's whole-object SHA-256 and compares
it to the stored `ObjectEntity.contentSha256` (the same digest the read-time integrity gate
F1 already uses). Each object gets a persisted integrity verdict (`unchecked | ok | corrupt`)
plus a `integrityCheckedAt` timestamp and a bounded `integrityDetail`. When a blob is found
corrupt AND a replication target is configured (STORY-0900), the runner fetches the good
remote copy, re-verifies it against the stored digest, and atomically replaces the local
blob. Corruption is surfaced through a guarded admin endpoint and a small badge in the
admin console. The runner is strictly rate-limited (batched cursor scan, per-tick byte/object
budget, `setImmediate` yields) so it never competes with foreground I/O.

## Acceptance criteria
- [ ] A new `IntegrityScrubRunner implements ScheduledTask` is registered in `BackgroundModule` (providers + the `SCHEDULED_TASKS` factory `inject` list) and runs on its own interval via the existing tick scheduler.
- [ ] The scrub is OFF by default: with `OB_INTEGRITY_SCRUB_ENABLED` unset, `run()` returns immediately and performs zero disk reads or DB writes (mirrors `TieringSweepRunner`'s default-off gate).
- [ ] For each scanned current, local, non-soft-deleted object with a non-null `contentSha256`, the runner re-hashes the on-disk blob (decrypting SSE via `createSseDecipher` when `encryption` is set) and persists `integrityStatus` + `integrityCheckedAt`.
- [ ] A blob whose recomputed SHA-256 differs from the stored digest is marked `corrupt` (never served — the F1 read gate already 500s it) and, when `ReplicationTargetService.enabled`, repaired by streaming the remote copy, staging it via `BlobStore` (tmp → fsync → atomic rename), re-verifying, and only then flipping the row back to `ok`.
- [ ] The scrub is bounded per tick: at most `INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK` objects and `OB_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK` bytes are hashed, it yields to the event loop between batches, and it resumes from a persisted cursor next tick — a multi-TB store is walked incrementally without pinning the EM or event loop.
- [ ] `GET /api/admin/integrity/status` (JwtAuthGuard, `default` throttler) returns `{ enabled, scanned, ok, corrupt, unchecked, repaired, lastRunAt, cursor }` and `GET /api/admin/integrity/corrupt` returns a bounded, paged list of corrupt objects `{ bucket, key, checkedAt, detail }` — never any remote endpoint/credential.
- [ ] The admin console shows a corruption indicator (a red badge with the corrupt count) sourced from an Angular signal store; it reads `getIntegrityStatus` and shows a not-configured/clean state when `corrupt === 0`.
- [ ] Per-object failures (ENOENT, remote outage, re-verify mismatch) are isolated: caught, logged with a redacted message, the cursor still advances, and the tick never throws.
- [ ] EPIC-08 security posture preserved: no secret/endpoint is logged, audited, or returned by any integrity route; any new dependency is externalized in all three package manifests; `/metrics` (if the optional gauge task lands) exposes only counts, never object keys or credentials.

## Tasks
- [TASK-3640] Extract reusable blob SHA-256 verification into a shared IntegrityVerifier service
- [TASK-3641] Add per-object integrity status columns, migration, and paged scan query
- [TASK-3642] Implement the throttled IntegrityScrubRunner background tick
- [TASK-3643] Repair corrupt blobs from the replication target
- [TASK-3644] Add the admin integrity endpoint, console indicator, and optional Prometheus gauge

## Test plan
- [TEST-1204] Integrity scrub: detection, throttling, repair, and admin/console surfacing

## Dependencies
- Blocks: —
- Blocked by: [STORY-0208] (BlobStore + stored SHA-256), [STORY-0209] (two-phase writer / atomic rename), [STORY-0900] (replication target), the F1 read-time integrity gate (`ObjectService.verifyBlobIntegrity`)

## References
- `libs/nestjs/src/lib/storage/blob-store.ts` — `BlobStore.getBlob`, `putBlob` (returns hex `sha256`), `atomicRename`/`fsyncFile`/`fsyncDir`, `PathResolver`
- `libs/nestjs/src/lib/persistence/entities/object.entity.ts` — `ObjectEntity.contentSha256`, `encryption`, `location`, `softDeleted`, `currentVersionId`
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `verifyBlobIntegrity` (F1 gate, line ~767), `createSseDecipher`, `RANGE_VERIFY_MAX_BYTES`
- `libs/nestjs/src/lib/common/background/background.service.ts` — `ScheduledTask`, `SCHEDULED_TASKS`, per-tick `RequestContext`, no-pile-up guard
- `libs/nestjs/src/lib/common/background/tiering-sweep.runner.ts` — batched-cursor + `setImmediate` throttle pattern; `libs/nestjs/src/lib/common/background/reconcile.runner.ts` — `redactError`
- `libs/nestjs/src/lib/common/background/background.module.ts` — runner registration (providers + `SCHEDULED_TASKS` inject list)
- `libs/nestjs/src/lib/storage/replication/replication-target.service.ts` — `ReplicationTargetService.enabled`/`get`/`head`; `REPLICATION_CONFIG`
- `libs/nestjs/src/lib/admin/replication/replication-admin.controller.ts` + `libs/nestjs/src/lib/admin/admin.module.ts` — admin controller + `ADMIN_CHILDREN` registration pattern
- `libs/nestjs/src/lib/common/config/env.schema.ts` + `common/config/app-config.service.ts` — `envBoolean`, config-knob pattern
- `apps/openbucket-frontend/src/app/replication/replication.signal-store.ts` + `replication.component.ts`; `apps/openbucket-frontend/src/app/settings/settings.component.ts`; `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts`
- New dep (optional, TASK-3644): `prom-client` — externalize in `package.json`, `apps/openbucket-backend/package.json`, `libs/nestjs/package.json` (the `apps/openbucket-backend/webpack.config.js` externals list is derived from the backend `package.json`)
