---
id: TASK-3632
title: Implement ScheduledBackupRunner on the background tick with fs-persisted run state
story: STORY-1203
status: backlog
type: implementation
size: L
---

## Description
Add a `ScheduledBackupRunner` that implements `ScheduledTask` and is registered in
`background.module.ts` alongside the other runners. It wakes on the fixed
`checkIntervalMs` tick, decides whether a snapshot is due from the cron/interval
schedule plus a filesystem-persisted last-run marker, writes the snapshot(s) via
`BackupService.writeSnapshot` (TASK-3630), and records run state — reusing the
filesystem-as-source-of-truth pattern from `TrashPurgeRunner` so no DB table or
migration is needed and the feature stays embeddable.

## Files to create / modify
- `libs/nestjs/src/lib/admin/backup/scheduled-backup.runner.ts` — new (the `ScheduledTask`)
- `libs/nestjs/src/lib/admin/backup/scheduled-backup.service.ts` — new (snapshot orchestration + run-state persistence, shared with the controller's run-now)
- `libs/nestjs/src/lib/admin/backup/backup.module.ts` — modify (provide the service + config + export the service)
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify (add `ScheduledBackupRunner` to `providers` **and** the `SCHEDULED_TASKS` factory `inject` list)
- `libs/nestjs/src/lib/admin/backup/scheduled-backup.runner.spec.ts` — new
- `libs/nestjs/src/lib/admin/backup/scheduled-backup.service.spec.ts` — new

## Implementation notes
- Runner shape (config-driven interval like `UsageRollupRunner`, no-op-when-disabled
  like `ReplicationWorkerRunner`):

  ```ts
  @Injectable()
  export class ScheduledBackupRunner implements ScheduledTask {
    readonly name = 'scheduled-backup';
    get intervalMs(): number { return this.config.checkIntervalMs; }
    async run(): Promise<void> {
      if (!this.config.enabled) return;               // registered unconditionally
      if (!this.svc.isDue(this.clock.nowMs())) return;
      await this.svc.runSnapshotCycle('scheduled');
    }
  }
  ```

  The `BackgroundService` already wraps every tick in a per-tick `RequestContext`
  and enforces the no-pileup guard (a slow snapshot cycle simply skips the next
  wake), so the runner needs no ORM plumbing of its own.
- `ScheduledBackupService` owns the real work so the controller's run-now
  (TASK-3634) shares it:
  - **Due check**: read `state.json` (below) for `lastRunAt`; compute `nextRunAt`
    from the schedule — for `intervalMinutes`, `lastRunAt + intervalMinutes*60_000`
    (or "now" if never run); for `cron`, `CronExpressionParser.parse(cron, { currentDate: new Date(lastRunAt) }).next()`.
    `isDue(now) = now >= nextRunAt`.
  - **Snapshot cycle**: for `scope: 'instance'` write one snapshot; for
    `scope: 'buckets'` iterate `bucketRepo.listAll()` and write one per bucket,
    isolating per-bucket failures (a throw on one bucket is logged and does not abort
    the others — mirrors `TrashPurgeRunner`'s per-entry `try/catch`). Each snapshot:
    1. pre-flight free-space check — if `statfs(dir).bavail*bsize < DATA_DIR_MIN_FREE_BYTES`, **skip** the cycle with a WARNING (don't fill the disk / self-DoS);
    2. `mkdir(dir/<scope>, { recursive: true, mode: 0o700 })`;
    3. open `createWriteStream(tmp, { mode: 0o600 })` where `tmp = <final>.part`, pipe through a `sha256` hash + byte counter, call `backup.writeSnapshot(sink, kind, names)`;
    4. `fsync` the fd, then atomic `rename(tmp, final)` — a crash leaves only a `.part` (swept next cycle), never a torn `.zip` seen as a good backup;
    5. write a sidecar `<final>.json` `{ createdAt, scope, bucket?, bytes, objectCount, sha256 }`.
  - **File naming**: `<dir>/<scope>/<ISO-compact-timestamp>-<uuidv7>.zip` (uuidv7 is
    already a dependency — see `usage-rollup.runner.ts`) so lexical sort == time sort
    and two snapshots in the same second can't collide.
  - Delegate pruning + optional replication push to TASK-3633's helpers after each
    successful cycle.
  - **Run state** (`<dir>/state.json`, filesystem source of truth like trash
    manifests): `{ lastRunAt, lastStatus: 'ok'|'error'|'skipped', lastError?, lastDurationMs, lastBytes, lastObjectCount, lastSnapshotCount }`. Written atomically (`.part` → rename). `nextRunAt` is computed on read, never stored, so a config change takes effect immediately.
- **Concurrency**: an in-memory `private inFlight?: Promise<void>` in the service
  guards `runSnapshotCycle` so the scheduled tick and a run-now can never overlap
  (the tick already can't pile up on itself; run-now is the other caller). A second
  concurrent call awaits/*joins* the in-flight promise rather than starting a
  second cycle.
- **Security/DoS**:
  - snapshots contain **decrypted plaintext object bytes** (same as the existing
    download / replication) — hence `0o600` files / `0o700` dir, and a doc note that
    the backup volume inherits the data volume's trust boundary. No secrets are ever
    written into a snapshot (only object data + the existing manifest metadata).
  - the free-space guard + retention (TASK-3633) bound disk growth so a stuck
    scheduler can't exhaust the volume.
  - nothing derived from a request reaches these fs paths — `dir` is boot config,
    bucket names come from the repo (already S3-validated); still run the snapshot
    through the existing `writeSnapshot` which reuses the vetted read path.
  - never log `dir` contents, credentials, or object keys; log counts + durations
    only (matches `RequestMetricsService`).

## Acceptance criteria
- [ ] `ScheduledBackupRunner` is registered in `background.module.ts` (`providers` + factory `inject`) and is a no-op when `enabled` is false.
- [ ] With interval scheduling and a fast-forwarded `Clock`, a snapshot `.zip` + `.json` sidecar is written atomically and `state.json` reflects `lastRunAt` / `lastStatus: 'ok'`.
- [ ] `scope: 'buckets'` writes one snapshot per bucket and a failure on one bucket does not prevent the others.
- [ ] A crash mid-write (simulated by leaving a `.part`) never surfaces as a valid snapshot and the `.part` is cleaned up on the next cycle.
- [ ] A free-space shortfall skips the cycle with `lastStatus: 'skipped'` and no partial file.
- [ ] `nx test nestjs --testPathPattern='scheduled-backup'` passes.

## Test obligations
- Unit: covered by [TEST-1203] (cases 3, 4, 5, 6)
- E2E: covered by [TEST-1203] (case 8)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3630], [TASK-3631]
