---
id: TEST-1203
title: Scheduled backups, retention pruning, replication push, and run-now/status
covers: [STORY-1203, TASK-3630, TASK-3631, TASK-3632, TASK-3633, TASK-3634]
status: backlog
level: unit
---

## Goal
Verify that scheduled backups: reuse the existing snapshot format (byte-identical to
the admin download), fire on the configured cadence with a fast-forwarded `Clock`,
write atomically, prune by union keep-last-N / max-age retention, optionally push to
the replication target under a reserved prefix without failing the cycle on push
error, and surface accurate JWT-guarded status + a flood-safe run-now — all without
leaking paths, keys, or secrets.

## Setup
- Jest unit/integration harness (as `scheduled-backup.*.spec.ts`, `backup.service.spec.ts`).
- A fake `Clock` (the injectable `Clock` used by `trash-purge` / `usage-rollup`) so
  retention windows and cron/interval due-times are fast-forwarded deterministically.
- A temp `DATA_DIR` per test; `OPENBUCKET_SCHEDULED_BACKUP_DIR` under it (or defaulted).
- A stub `ReplicationTargetService` capturing `putObject({ key, contentLength, contentType })`
  and toggleable to throw, plus a `.enabled` toggle.
- Seed a bucket + a few objects via the domain services so `writeSnapshot` has real
  content and a real `BackupManifest`.
- For case 8 (e2e): `nx e2e openbucket-backend-e2e` extending
  `apps/openbucket-backend-e2e/src/backup-restore.e2e-spec.ts`, with an admin JWT.

## Cases
1. **Snapshot parity (TASK-3630)** — given seeded objects, when `writeSnapshot(sink, 'instance', names)` writes to a file sink, then the resulting `.zip`'s `manifest.json` + `data/…` entries are byte-identical to `streamInstanceBackup`'s download, and the returned `{ bytes, objectCount }` matches the archive.
2. **Config resolution + fail-fast (TASK-3631)** — given `OPENBUCKET_SCHEDULED_BACKUP_ENABLED=true` with neither interval nor cron, boot fails; with both set, boot fails; with a malformed `OPENBUCKET_SCHEDULED_BACKUP_CRON`, boot fails; with a valid cron only, `resolveScheduledBackupConfig` returns the defaulted shape and `dir` = `<dataDir>/backups`.
3. **Disabled = no-op (TASK-3632)** — given `enabled: false`, when the runner ticks, then no file is written and `state.json` is absent.
4. **Interval due + atomic write (TASK-3632)** — given `intervalMinutes: 60` and last-run 61 min ago (fake clock), when the runner ticks, then one `.zip` + `.json` sidecar exist, the file mode is `0o600`, no `.part` remains, and `state.json.lastStatus === 'ok'` with a fresh `lastRunAt`; ticking again 1 min later writes nothing (not yet due).
5. **Per-bucket scope + failure isolation (TASK-3632/3633)** — given `scope: 'buckets'` with 3 buckets where one object read throws, when a cycle runs, then the other two buckets produce snapshots and the failure is logged (cycle not aborted); retention is applied per bucket.
6. **Union retention (TASK-3633)** — given `keepLast: 3`, `maxAgeDays: 30`, when 5 snapshots are written across simulated time, then exactly the newest 3 **or** any younger than 30 days are retained and only entries failing both are deleted (`.zip` + `.json` removed together); assert an old-but-within-last-3 entry survives and a within-30-days-but-beyond-3 entry survives.
7. **Replication push (TASK-3633)** — given `pushToReplication: true` + a stub target `.enabled`, when a snapshot completes, then `putObject` is called once with key `_ob_backups/<scope>/<name>.zip`, `contentType: 'application/zip'`, and `contentLength` = snapshot bytes; when the stub `putObject` throws, the local snapshot still exists, the cycle is `ok`, the read stream fd is destroyed, and no exception propagates; with target `.enabled=false` the push is skipped. Assert `listRemoteObjects` filters the `_ob_backups/` prefix.
8. **Status + run-now round-trip (TASK-3634, e2e)** — given an enabled schedule, when `GET /api/admin/backup/schedule` is called without a JWT it returns 401; with a JWT it returns status carrying no `dir`/credential/key fields; `POST /api/admin/backup/schedule/run-now` returns 202 and produces one snapshot; a second concurrent run-now returns `{ started: false }` and does not create a second concurrent snapshot; a follow-up `GET` shows the updated `lastRunAt`.
9. **Free-space guard (TASK-3632)** — given a stubbed free-space probe below `DATA_DIR_MIN_FREE_BYTES`, when a cycle would run, then it is skipped with `lastStatus: 'skipped'`, no partial file is left, and a warning is logged.

## Tooling
- Framework: jest (+ supertest for case 8)
- Runner: `nx test nestjs --testPathPattern='scheduled-backup|backup.service|backup.controller|env.schema|open-bucket-options'` and `nx e2e openbucket-backend-e2e`

## Pass criteria
- [ ] Cases 1–9 pass deterministically under the fake `Clock` (no real sleeps).
- [ ] No snapshot, log line, or API payload contains `secretAccessKey`, the backup `dir` absolute path, or object keys.
- [ ] `nx build openbucket-backend` keeps `cron-parser` external; `nx build openbucket-frontend` + `nx lint openbucket-frontend` pass.
- [ ] The refactor (TASK-3630) leaves the existing `backup-restore.e2e-spec.ts` green.

## References
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` (`writeSnapshot`, `BackupManifest`)
- `libs/nestjs/src/lib/common/background/trash-purge.runner.spec.ts`, `usage-rollup.runner.spec.ts` (fake-`Clock` + fs-runner test patterns)
- `libs/nestjs/src/lib/storage/replication/replication-target.service.ts` (`putObject`, `listRemoteObjects`, `TIER_PREFIX`)
- `apps/openbucket-backend-e2e/src/backup-restore.e2e-spec.ts`
