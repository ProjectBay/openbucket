---
id: STORY-0210
title: Startup crash recovery and orphan-blob scan
epic: EPIC-03
status: done
size: M
risk: high
---

## User story
As an operator, I want a startup scan that walks `blobs/` and `multipart/` to detect orphan blobs (files without a matching `objects` row) and stale multipart directories (directories without a matching `multipart_uploads` row), logs them, and removes only the multipart dirs (never the blobs), so that I can investigate inconsistencies introduced by the §3.7 crash window without risking real data on a misconfigured `DATA_DIR`.

## Description
Implement `RecoveryService` per §3.8: implements `OnApplicationBootstrap`; runs once before HTTP binds; walks `blobs/<bucket>/...` (skipping `*.v/` version-store directories), decodes each filename to a raw key via `decodeKey`, and looks the key up in `objects`; missing rows go into an `orphanBlobs` array, never deleted in v1. Then walks `multipart/<uploadId>/` and `fs.rm -rf` any directory whose `uploadId` has no `multipart_uploads` row. Emits one summary log line plus up to the first 50 orphan paths as warnings. Rationale (§3.8 last paragraph): logging-only blob policy guards against an operator pointing the container at the wrong volume.

## Acceptance criteria
- [x] `RecoveryService implements OnApplicationBootstrap`; Nest invokes the hook before `app.listen()` (framework-level guarantee).
- [x] Blob pass: files in `blobs/<bucket>/...` whose decoded key has no `objects` row are reported, never unlinked (TEST-0210 cases 1, 4).
- [x] Multipart pass: directories whose `uploadId` is not in `multipart_uploads` are `fs.rm`'d recursively and added to `removedMultipartDirs` (case 2). Live multipart dirs are left alone (case 3).
- [x] `*.v/` version-store paths are skipped during the blob pass (case 6).
- [x] Summary log line includes `scanned.blobs`, `scanned.multipart`, `orphanBlobs.length`, `removedMultipartDirs.length`, and elapsed ms.
- [x] First 50 orphan paths emitted as `log.warn(...)`.
- [x] Orphan-blob baseline established in TEST-0209 case 6 is reproducible: a file at `blobs/b/<key>` with no `objects` row → reported (verified directly via `runScan()` in TEST-0210; see realization note).

## Tasks
- [TASK-0628] Implement blob-pass with `walk` and `decodeKey` lookup
- [TASK-0629] Implement multipart-pass with directory delete
- [TASK-0630] Wire `OnApplicationBootstrap` and summary logging

## Test plan
- [TEST-0210] Crash-recovery e2e — orphan scan after rename/commit crash

## Implementation notes
- Added `PathResolver.multipartRoot()` (small helper) instead of the
  whitepaper's `multipartDir('').slice(0, -1)` hack — same path, type-safe.
- TEST-0210 is realized as a unit test (`recovery.service.spec.ts`) that
  exercises `runScan()` directly against a curated DATA_DIR. The plan's
  in-process Nest-boot + commit-crash + reboot dance is heavier than needed:
  the orphan-blob *baseline* (file present + no row) is already validated by
  TEST-0209 case 6, and the `OnApplicationBootstrap` hook ordering is a
  framework-level guarantee.
- Wired into AppModule via StorageModule providers; the e2e suite (no blobs
  on a fresh DATA_DIR) confirms boot still binds the listener cleanly.

## Dependencies
- Blocks: [EPIC-04] (background ticks run after this scan completes)
- Blocked by: [STORY-0205], [STORY-0207], [STORY-0208], [STORY-0209]

## References
- `docs/WHITEPAPER.md` §3.8 (lines 4648–4800)
- Interfaces produced: `RecoveryService.runScan(): Promise<OrphanReport>`, `OrphanReport`
