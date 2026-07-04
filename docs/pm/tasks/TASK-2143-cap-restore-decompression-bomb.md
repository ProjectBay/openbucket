---
id: TASK-2143
title: Cap restore decompression bomb and stage-then-swap the restore
story: STORY-0704
status: ready
type: implementation
size: L
---

## Description
Remediates audit finding #21 (MEDIUM, **CWE-409** Improper Handling of Highly
Compressed Data / **CWE-400** Uncontrolled Resource Consumption). The backup restore
path enforces no limit on total decompressed bytes, per-entry size, entry count, or
compression ratio: `forEachObjectEntry` streams each `data/` entry straight into
`writer.put` and `putBlob` has no `maxSize` guard. Worse, `restoreInstance` **wipes
and deletes every existing bucket before** the object-writing loop, so a bomb that
fills the disk mid-restore leaves the instance both wiped and un-restored — data loss,
not merely a transient DoS. This Task adds streaming decompression caps and makes
whole-instance restore non-destructive on failure.

## Files to create / modify
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` — modify: add a running
  decompressed-byte counter and per-entry/entry-count caps in `readZip` (`:326`) /
  `forEachObjectEntry` (`:357`); cross-check each entry against its declared
  `manifest.objects[].size`; restructure `restoreInstance` (`:186`) to stage into a
  temp area and swap only on success instead of wiping first (`:190`–`:198`).
- `libs/nestjs/src/lib/storage/blob-store.ts` — modify: add an optional `maxSize`
  parameter to `putBlob` (`:69`) that aborts the pipeline and unlinks the temp file
  once `bytesWritten` exceeds the cap.
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify: add
  `RESTORE_MAX_TOTAL_BYTES`, `RESTORE_MAX_ENTRY_BYTES`, and `RESTORE_MAX_ENTRIES`
  limit vars with sane defaults.
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify: typed getters
  for the new limits.

## Implementation notes
- Vulnerable sinks: `restoreObject` (`backup.service.ts:283`) calls
  `this.writer.put({ bucket, key, body: stream, ... })` with no size check; the
  `putBlob` hasher at `blob-store.ts:83` already tracks
  `bytesWritten += BigInt(chunk.length)` on the plaintext input `'data'` handler — reuse
  that counter to enforce a per-entry cap and `destroy()` the stream past the limit.
- Add a running total across all entries in the `readZip`/`forEachObjectEntry` loop
  (`:357`); abort with a `BadRequestException` (400) once `RESTORE_MAX_TOTAL_BYTES` or
  `RESTORE_MAX_ENTRIES` is exceeded. Cross-check each entry's observed bytes against
  the matching `manifest.objects.find(o => o.bucket === bucket && o.key === key).size`
  and reject on mismatch, catching a manifest that under-declares a bomb entry.
- Non-destructive restore: `restoreInstance` (`:186`) currently does
  `for (const b of existing) { await this.wipeBucketObjects(b.name); await this.buckets.deleteByName(...) }`
  at `:191`–`:195` **before** the write loop at `:200`. Restructure so the archive is
  validated and object bytes are staged (temp bucket dirs / temp DATA_DIR) fully, and
  the live buckets are swapped/deleted only after the staged write completes — so a
  mid-restore abort (disk full, cap tripped) leaves the existing instance intact.
- Note: the existing Zip Slip / bucket-name guards (`assertSafeBucket`/`assertSafeKey`)
  already run in the manifest pass (`:335`) and per-entry (`:369`); this Task adds the
  *size/ratio* dimension they do not cover.

## Acceptance criteria
- [ ] A restore archive whose decompressed total exceeds `RESTORE_MAX_TOTAL_BYTES` is
      rejected with 400 before the disk fills, and no partial blobs remain.
- [ ] A single entry exceeding `RESTORE_MAX_ENTRY_BYTES`, or whose observed size does
      not match its `manifest.objects[].size`, is rejected with 400.
- [ ] An archive with more than `RESTORE_MAX_ENTRIES` payload entries is rejected.
- [ ] A whole-instance restore that fails mid-stream leaves all pre-existing buckets
      and objects intact (no wipe-before-write).
- [ ] `nx test nestjs --testPathPattern=backup` passes.

## Test obligations
- Unit: covered by [TEST-0704] (per-entry cap, total cap, manifest size cross-check)
- E2E: covered by [TEST-0704] (POST a bomb archive to restore → 400, instance intact)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2100], [STORY-0700] — the restore endpoint must be behind a
  fail-closed admin guard before its resource caps are meaningful.

## References
- White-box security audit, 2026-07-04 — finding #21 (CWE-409 / CWE-400).
- `libs/nestjs/src/lib/admin/backup/backup.service.ts:186,190-198,200` (instance restore), `:170` (bucket restore), `:283` (`restoreObject`), `:357` (`forEachObjectEntry`), `:326` (`readZip`).
- `libs/nestjs/src/lib/storage/blob-store.ts:69,83` (`putBlob`, byte counter).
</content>
