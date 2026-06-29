---
id: TASK-0630
title: Wire `OnApplicationBootstrap` and summary logging
story: STORY-0210
status: done
type: implementation
size: XS
---

## Description
Implement `onApplicationBootstrap()` so the scan runs once before HTTP binding. Emit one summary log line with elapsed ms plus all aggregate counts, then emit up to the first 50 orphan-blob paths as individual `log.warn(...)` lines so an operator can investigate.

## Files to create / modify
- `apps/openbucket-backend/src/storage/recovery.service.ts` — modify (add `onApplicationBootstrap`)
- `apps/openbucket-backend/src/storage/storage.module.ts` — modify (register `RecoveryService` as a provider) — if not already done by [EPIC-01]

## Implementation notes
- Body (verbatim from §3.8):
  ```ts
  async onApplicationBootstrap(): Promise<void> {
    const t0 = Date.now();
    const report = await this.runScan();
    this.log.log(
      `recovery scan: ${report.scanned.blobs} blobs, ${report.scanned.multipart} multipart dirs ` +
        `in ${Date.now() - t0}ms; ${report.orphanBlobs.length} orphan blobs, ` +
        `${report.removedMultipartDirs.length} stale multipart dirs cleaned`,
    );
    if (report.orphanBlobs.length > 0) {
      for (const o of report.orphanBlobs.slice(0, 50)) {
        this.log.warn(`orphan blob: bucket=${o.bucket} key=${o.key} path=${o.path}`);
      }
    }
  }
  ```
- Per §3.3.2 + §3.7 + §3.8 ordering: the migrator-up in [TASK-0615] runs before the listener binds, and Nest's `OnApplicationBootstrap` lifecycle hook runs after all modules have initialized but before `app.listen(...)` returns. The recovery scan therefore sees the migrated schema and runs once, before any HTTP request can land.

## Acceptance criteria
- [ ] Booting against an empty `DATA_DIR` logs the summary line with all four counts at zero and a non-negative elapsed ms.
- [ ] Booting against a `DATA_DIR` with one injected orphan logs a warning line containing `orphan blob:` and the encoded path.
- [ ] The HTTP listener does not bind before the scan returns (verified by a small e2e timing check or by hook-order inspection).

## Test obligations
- Unit: covered by [TEST-0210]
- E2E: covered by [TEST-0210]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0628], [TASK-0629]

## References
- `docs/WHITEPAPER.md` §3.8 (lines 4685–4700)
