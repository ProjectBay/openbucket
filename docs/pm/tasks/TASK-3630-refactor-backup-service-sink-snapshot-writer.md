---
id: TASK-3630
title: Refactor BackupService to a reusable sink-based snapshot writer
story: STORY-1203
status: backlog
type: refactor
size: M
---

## Description
Extract the archive-building core of `BackupService.streamBackup` so it writes into
any `Writable` sink, not only an Express `Response`. The scheduled runner
(TASK-3632) needs to write the exact same `.zip` (identical `BackupManifest`, same
per-object streaming) to a file on disk; today that logic is entangled with
response headers and `res.destroy`. This is a pure refactor: the streamed-download
endpoints keep byte-for-byte identical behaviour, and the new method is the single
seam both callers share.

## Files to create / modify
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` — modify (extract `writeSnapshot`; rewire `streamBucketBackup` / `streamInstanceBackup`)
- `libs/nestjs/src/lib/admin/backup/backup.service.spec.ts` — modify (add sink-writer coverage)

## Implementation notes
- Add a sink-based method that owns everything currently inside `streamBackup`
  except the two `res.setHeader(...)` lines and the `res.on('close')` abort wiring:

  ```ts
  async writeSnapshot(
    sink: Writable,
    kind: 'bucket' | 'instance',
    bucketNames: string[],
  ): Promise<{ bytes: number; objectCount: number }>
  ```

  It builds the `BackupManifest` (unchanged: `version: 1`, `createdAt`, per-bucket
  config, per-object rows), streams each object via `this.objects.openObjectStream`
  with the existing one-fd-at-a-time `await once(archive, 'entry')` backpressure,
  appends `manifest.json`, and `await archive.finalize()`. Count `objectCount` from
  `manifest.objects.length`; obtain `bytes` from a byte-counting `PassThrough`
  (or `archive.pointer()` after finalize) so callers get the snapshot size without
  re-`stat`-ing.
- Keep the `zlib: { level: 1 }` archiver setting and the `archive.on('error')`
  handling; on the file path a failure must reject the returned promise (so the
  runner marks the run failed and removes the partial `.part`), rather than
  `res.destroy`.
- `streamBucketBackup(bucket, res)` and `streamInstanceBackup(res)` become thin:
  resolve the bucket-name list exactly as today (`bucketRepo.getByName` /
  `bucketRepo.listAll`), set the `Content-Type` / `Content-Disposition` headers,
  wire `res.on('close')` → `archive.abort()`, then delegate to `writeSnapshot(res, …)`.
  To preserve the client-disconnect abort, either pass an optional
  `onArchive?(archive)` callback so the caller can retain the `archiver` handle for
  `abort()`, or keep the disconnect wiring in the wrapper by having `writeSnapshot`
  accept the pre-created `archive`. Prefer the former to keep one archive-creation
  site.
- **Edge cases**: an empty instance (no buckets) still writes a valid manifest with
  empty arrays; a metadata row with no blob (`openObjectStream` returns falsy —
  delete marker) is skipped exactly as today (`if (!opened) continue`); a bucket
  deleted mid-scan is tolerated (`if (!b) continue`).
- **Security/DoS**: no behaviour change to the read side — the manifest still
  captures only object metadata already returned by the repos; no new field, so no
  new redaction surface. The refactor must not alter the Zip Slip / decompression
  guards on the restore side (untouched).

## Acceptance criteria
- [ ] `writeSnapshot(sink, kind, names)` exists and returns `{ bytes, objectCount }`.
- [ ] `streamBucketBackup` / `streamInstanceBackup` produce a byte-identical archive to before (same manifest ordering, same entries) — verified against the existing e2e in `apps/openbucket-backend-e2e/src/backup-restore.e2e-spec.ts`.
- [ ] `nx test nestjs --testPathPattern=backup.service.spec.ts` passes, including a new case that writes a snapshot to an in-memory/file sink and re-reads the manifest.
- [ ] Client-disconnect abort on the download path is preserved (no leaked fds after `res` closes early).

## Test obligations
- Unit: covered by [TEST-1203] (case 1)
- E2E: covered by [TEST-1203] (case 8, download parity)
- Conformance: N/A

## Dependencies
- Blocked by: —
