---
id: TASK-0945
title: Implement expired-session enumeration and per-session row+fs cleanup
story: STORY-0315
status: done
type: implementation
size: S
---

## Description
Implement the body of `MultipartCleanupRunner.run`: query `MultipartService` (or repository) for sessions whose `createdAt < clock.nowMs() - ttlMs`; for each, delete the SQLite rows before `rm`'ing the staging directory.

## Files to create / modify
- `apps/backend/src/common/background/multipart-cleanup.runner.ts` — modify

## Implementation notes
- Compute the cutoff as `new Date(this.clock.nowMs() - ttlMs)`.
- Use `rm(join(this.config.dataDir, 'multipart', uploadId), { recursive: true, force: true })` matching the abort handler's pattern from §4.4.4.
- Wrap each session in a try/catch so one bad row does not abort the loop.

## Acceptance criteria
- [ ] Each expired session results in (a) a SQLite row deletion via `MultipartService` and (b) an `rm` of the staging directory in that order.
- [ ] Per-session errors are logged via `Logger.error` and the loop continues.

## Test obligations
- Unit: covered by [TEST-0321]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0944]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6442–6443), §4.4.4 (lines 6023–6029)
