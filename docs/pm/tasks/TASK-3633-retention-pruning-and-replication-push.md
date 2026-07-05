---
id: TASK-3633
title: Add retention pruning + optional push of the snapshot to the replication target
story: STORY-1203
status: backlog
type: implementation
size: M
---

## Description
After each successful snapshot cycle, prune prior snapshots by the retention policy
(keep-last-N and max-age) and — when `pushToReplication` is set and replication is
enabled — upload the new snapshot `.zip` to the replication target under a reserved
key prefix. Both are pure helpers on `ScheduledBackupService` (TASK-3632) so the
runner and run-now share them.

## Files to create / modify
- `libs/nestjs/src/lib/admin/backup/scheduled-backup.service.ts` — modify (add `pruneRetention` + `pushSnapshot`)
- `libs/nestjs/src/lib/storage/replication/replication-target.service.ts` — modify (add a generic `putReserved(key, body, contentLength, contentType?)` or reuse `putObject` with an explicit reserved-prefix key)
- `libs/nestjs/src/lib/admin/backup/scheduled-backup.service.spec.ts` — modify

## Implementation notes
- **Retention (`pruneRetention(scopeDir)`)** — list `*.zip` in `<dir>/<scope>` (for
  `scope: 'buckets'`, prune per-bucket sub-grouping so keep-last-N is per bucket,
  not global), sort by `createdAt` (from the sidecar, falling back to the sortable
  filename timestamp) descending, then apply **union retention**:

  ```
  retain(entry) = (rank < keepLast) || (ageDays(entry) < maxAgeDays)
  delete(entry) = !retain(entry)
  ```

  i.e. keep the newest `keepLast` **or** anything younger than `maxAgeDays`; delete
  only entries failing both. This makes keep-last-N a hard floor (old but within the
  last N is kept) and max-age unable to delete a fresh snapshot. Delete the `.zip`
  then its `.json` sidecar (`fs.rm(..., { force: true })`, tolerate ENOENT), log a
  single count. Also sweep orphan `*.part` files older than one cycle (crash debris).
  Batch + `setImmediate` yield between deletes like `TrashPurgeRunner` if the count
  is large. A per-file failure is logged, never aborts the sweep.
- **Replication push (`pushSnapshot(zipPath, meta)`)** — only when
  `config.pushToReplication && replicationTarget.enabled` (inject
  `ReplicationTargetService`, `@Optional()` so a build without replication still
  compiles; guard on `.enabled`). Upload the finished `.zip` under a reserved,
  collision-free prefix so it never masquerades as a replicated raw-key object or a
  tiered blob (which use `_ob_tiered/`):

  ```ts
  const key = `_ob_backups/${meta.scope}/${basename(zipPath)}`;
  await this.replication.putObject({
    key,
    body: createReadStream(zipPath),
    contentLength: meta.bytes,
    contentType: 'application/zip',
  });
  ```

  `putObject` already switches to `@aws-sdk/lib-storage` multipart above
  `largeObjectThresholdBytes`, so a multi-GB snapshot streams without buffering.
  Push failure is **non-fatal**: the local snapshot already succeeded and is the
  system of record, so a failed push is logged (truncated error) and the run is
  still `ok` with a `pushError` note — never rethrown to fail the whole cycle. Tear
  down the `createReadStream` fd on failure (`stream.destroy()`), mirroring
  `ReplicationWorkerRunner.send`.
- Add `_ob_backups/` to the reserve-prefix filter in `listRemoteObjects` (next to
  the existing `TIER_PREFIX` skip) so a reconcile scan (STORY-0902) never treats a
  pushed backup as a stray remote raw-key object to be deleted.
- **Security/DoS**:
  - the pushed `.zip` is decrypted plaintext (same posture as replication) — the
    same `http://`-endpoint boot warning already covers it; no new secret surface.
  - `secretAccessKey` stays inside the `S3Client` credentials closure; the reserved
    key + error messages contain no credentials.
  - retention is the primary disk-growth bound; the reserved-prefix isolation
    prevents a pushed backup from corrupting replication/tiering state.

## Acceptance criteria
- [ ] After N+1 snapshots with `keepLast=N`, exactly N `.zip` + N `.json` remain (union semantics), verified with a fast-forwarded `Clock`.
- [ ] An entry older than `maxAgeDays` but within the newest `keepLast` is retained; an entry within `maxAgeDays` beyond `keepLast` is retained; only entries failing both are deleted.
- [ ] With `pushToReplication=true` + replication enabled, the snapshot lands at `_ob_backups/<scope>/<name>.zip` on the target (multipart above the threshold); a push failure leaves the local snapshot intact and the cycle `ok`.
- [ ] With `pushToReplication=true` + replication **disabled**, the push is skipped (no throw) and a boot warning was emitted (TASK-3631).
- [ ] `listRemoteObjects` filters `_ob_backups/`; `nx test nestjs --testPathPattern='scheduled-backup|replication-target'` passes.

## Test obligations
- Unit: covered by [TEST-1203] (cases 5, 6, 7)
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3632]
