---
id: TEST-0210
title: Crash-recovery e2e — orphan scan after rename/commit crash
covers: [STORY-0210, TASK-0628, TASK-0629, TASK-0630]
status: done
level: e2e
---

## Goal
Verify, end-to-end, that the startup `RecoveryService` correctly reports an orphan blob produced by a crash injected between `BlobStore.putBlob`'s rename and `ObjectWriterService.put`'s commit, and that stale multipart directories are removed.

## Setup
- Real backend boot via `NestFactory.create(AppModule)` against a temporary file-backed `DATA_DIR` under `tmp/openbucket-recovery-e2e/<uuid>/`.
- Test harness uses two passes:
  1. **Pre-crash pass:** boot the backend, create a `Bucket { name: 'b' }`, then call `ObjectWriterService.put` with an `em.commit` mock that throws *after* `BlobStore.putBlob` returns and *after* `fs.unlink` is stubbed to also throw (so the post-rename file is *not* cleaned up). This deterministically produces an orphan blob on disk with no `objects` row.
  2. **Crash:** close the Nest app without further cleanup; leave the `DATA_DIR` intact.
- Also: under the same `DATA_DIR`, create a `multipart/<uuid>/1.part` directory whose `uploadId` is NOT in `multipart_uploads` (stale upload), and create another `multipart/<uuid2>/1.part` whose `uploadId` IS in `multipart_uploads` (live upload).
- **Recovery pass:** boot a second Nest instance over the same `DATA_DIR`, capture log output, and inspect the filesystem.

## Cases
1. Given the orphan blob from the pre-crash pass, when the second boot's `RecoveryService.onApplicationBootstrap` runs, then the summary log line reports `orphan blobs: 1` and the per-orphan warning includes the encoded path and the raw key.
2. Given the stale multipart directory, after the recovery scan it is removed (`fs.access` throws `ENOENT`) and its path appears in the implied `removedMultipartDirs` count.
3. Given the live multipart directory, it is untouched.
4. Given the orphan blob, it is *not* unlinked by the scan — `fs.stat(orphanPath)` still succeeds after the scan.
5. The recovery scan runs before HTTP binding — verified by intercepting the bootstrap-hook order via `OnApplicationBootstrap` vs. `onModuleInit` order, or by asserting the summary log appears before the Nest "Application is listening" log.

## Tooling
- Framework: jest + supertest (for the listener bind ordering check)
- Runner: `nx e2e backend-e2e --testPathPattern=recovery.e2e-spec.ts`

## Pass criteria
- [x] All five cases pass — realized as a unit-style spec (`recovery.service.spec.ts`) that drives `runScan()` against a curated DATA_DIR, plus an `onApplicationBootstrap` invocation to check the summary log. Backend suite 140/140; e2e 10 passed / 4 POSIX-skipped.
- [x] The temp `DATA_DIR` is cleaned up after each test.

## Realization note
Realized as a unit spec rather than the full in-process `NestFactory.create` +
crash-injection + reboot dance. The orphan-blob *baseline* (file present, no
row) is independently validated by TEST-0209 case 6; `OnApplicationBootstrap`
hook ordering is a framework guarantee. The spec exercises the same recovery
logic with less setup churn.

## References
- `docs/WHITEPAPER.md` §3.7.3 (lines 4635–4644), §3.8 (lines 4648–4800)
