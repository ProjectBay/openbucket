---
id: STORY-1203
title: Scheduled backups & retention
epic: EPIC-13
status: backlog
size: M
risk: medium
---

## User story
As an operator, I want OpenBucket to take scheduled per-bucket and whole-instance
snapshots on a cadence I configure, prune them by a retention policy, and
optionally push each snapshot to my replication target, so that I have hands-off,
point-in-time backups I can trust in production without wiring an external cron +
`curl` against the admin download endpoints.

## Description
Reuse the existing snapshot logic in `admin/backup/backup.service.ts`
(`streamBackup` / `streamBucketBackup` / `streamInstanceBackup`, the v1
`BackupManifest` `.zip` format) to write snapshots to a configurable directory on
the existing §4.9 background tick, instead of only streaming a `.zip` to an admin
download. A new `ScheduledBackupRunner` (implementing `ScheduledTask`, registered in
`common/background/background.module.ts` next to `TrashPurgeRunner` /
`UsageRollupRunner`) wakes on a fixed check interval, decides whether a snapshot is
due from a cron/interval schedule plus a filesystem-persisted last-run marker,
writes the snapshot atomically, prunes prior snapshots by keep-last-N / max-age, and
— when replication is configured — pushes the `.zip` to the target under a reserved
key prefix. The admin backup UI gains last-run / next-run status and a "Run now"
button. Config flows through both sources (standalone env + library `forRoot`
options) exactly like replication (STORY-0900). Backups are stored as **decrypted
plaintext object bytes** (same as replication / the existing download), so the
snapshot directory inherits the EPIC-08 trust boundary: restrictive file modes, no
secrets in `/metrics` or logs, and JWT-guarded admin endpoints.

## Acceptance criteria
- [ ] `BackupService` exposes a sink-based snapshot method (`writeSnapshot(sink, kind, bucketNames)` returning `{ bytes, objectCount }`); `streamBucketBackup` / `streamInstanceBackup` are refactored to call it so the streamed-download and scheduled-file paths share one code path and one `BackupManifest` writer.
- [ ] With `OB_SCHEDULED_BACKUP_ENABLED=false` (default) no snapshot is written and the runner is a no-op (registered unconditionally, mirrors `ReplicationWorkerRunner.run`'s `if (!enabled) return`).
- [ ] With scheduling enabled and `OB_SCHEDULED_BACKUP_INTERVAL_MINUTES` (or `OB_SCHEDULED_BACKUP_CRON`) set, a snapshot `.zip` + sidecar `.json` metadata appears under `<OB_SCHEDULED_BACKUP_DIR>/<scope>/` on the configured cadence, written atomically (`.part` → `fsync` → `rename`) with mode `0o600`.
- [ ] Retention prunes snapshots: an entry is retained iff it is among the newest `keepLast` **or** younger than `maxAgeDays`; it is deleted only when it fails both — so keep-last-N never deletes below the floor even for old entries, and max-age never deletes a fresh entry.
- [ ] When `OB_SCHEDULED_BACKUP_PUSH_TO_REPLICATION=true` **and** replication is enabled, each new snapshot `.zip` is uploaded via `ReplicationTargetService.putObject` under the reserved `_ob_backups/` prefix (multipart for large archives); when replication is disabled the flag is ignored with a boot-time warning.
- [ ] `GET /api/admin/backup/schedule` returns `{ enabled, scope, schedule, lastRunAt, nextRunAt, lastStatus, lastError, lastDurationMs, lastBytes, lastObjectCount, keepLast, maxAgeDays, snapshotCount }` — no directory paths, credentials, or object keys in the payload.
- [ ] `POST /api/admin/backup/schedule/run-now` triggers exactly one snapshot + prune, guarded by an in-flight lock so it can neither overlap a scheduled tick nor be flooded into N concurrent snapshots; both endpoints are behind the global admin JWT guard.
- [ ] The Angular `backup-restore.component.ts` shows last-run / next-run and a "Run now" button (signals-based, `OnPush`), refreshing status after the run resolves.
- [ ] A malformed `OB_SCHEDULED_BACKUP_CRON` fails fast at boot (env schema / `validateSecurityCriticalOptions`), never mid-tick; a snapshot is skipped (with a warning, not a crash) when free space is below `DATA_DIR_MIN_FREE_BYTES`.
- [ ] `/metrics` (STORY-1202) exposes only a last-success timestamp / last-bytes / snapshot-count gauge for backups — never a path, key, or secret — consistent with `RequestMetricsService`'s counts-only posture.

## Tasks
- [TASK-3630] Refactor BackupService to a reusable sink-based snapshot writer
- [TASK-3631] Add scheduled-backup config knobs across env schema + module options
- [TASK-3632] Implement ScheduledBackupRunner on the background tick with fs-persisted run state
- [TASK-3633] Add retention pruning + optional push of the snapshot to the replication target
- [TASK-3634] Expose schedule status + "Run now" in the admin API and backup UI

## Test plan
- [TEST-1203] Scheduled backups, retention pruning, replication push, and run-now/status

## Dependencies
- Blocks: —
- Blocked by: [STORY-0900] (replication target + `ReplicationTargetService.putObject`, for the optional push), [EPIC-08] (`admin/backup/` snapshot logic + the admin JWT guard / secret-redaction posture)

## References
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` — `streamBackup`, `streamBucketBackup`, `streamInstanceBackup`, `interface BackupManifest`, `PAGE`, `DATA_PREFIX`
- `libs/nestjs/src/lib/admin/backup/backup.controller.ts`, `backup.module.ts`
- `libs/nestjs/src/lib/common/background/background.service.ts` — `ScheduledTask`, `SCHEDULED_TASKS`, `BackgroundService.runOnce`, per-tick `RequestContext`, no-pileup guard
- `libs/nestjs/src/lib/common/background/background.module.ts` — `SCHEDULED_TASKS` factory `inject` list
- `libs/nestjs/src/lib/common/background/trash-purge.runner.ts` — filesystem-as-source-of-truth runner + batch yielding
- `libs/nestjs/src/lib/common/background/usage-rollup.runner.ts` — config-driven `intervalMs` getter + retention prune
- `libs/nestjs/src/lib/storage/replication/replication-target.service.ts` — `putObject` (small vs. multipart), `TIER_PREFIX` reserved-prefix precedent
- `libs/nestjs/src/lib/storage/replication/replication-config.ts` — `resolveReplicationConfig`, `REPLICATION_CONFIG`
- `libs/nestjs/src/lib/open-bucket-options.ts` — `OpenBucketModuleOptions`, `ResolvedOpenBucketOptions`, `resolveOptions`, `validateSecurityCriticalOptions`
- `libs/nestjs/src/lib/common/config/env.schema.ts`, `app-config.service.ts`, `config-source.ts`
- `apps/openbucket-frontend/src/app/backup-restore/backup-restore.component.ts`
- `apps/openbucket-backend/webpack.config.js` (`externalDependencies`) — 3-place externalization for the new `cron-parser` dep (also `libs/nestjs/package.json` + `apps/openbucket-backend/package.json`)
- New dep: `cron-parser` (pure-JS cron expression → next-run computation; only required when `OB_SCHEDULED_BACKUP_CRON` is used)
