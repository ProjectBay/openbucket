---
id: TEST-0321
title: MultipartCleanupRunner unit tests with TestClock
covers: [STORY-0315, TASK-0944, TASK-0945, TASK-0946]
status: done
level: unit
---

## Goal
Verify that `MultipartCleanupRunner.run` enumerates sessions older than `MULTIPART_TTL_HOURS`, deletes the SQLite row before the staging directory, and tolerates per-session errors.

## Setup
- Real fs/promises against an OS temp `dataDir`.
- Mock `MultipartService` query/delete surface; mock `ConfigService` with a small TTL (e.g. 1 hour).
- Inject a `TestClock`.

## Cases
1. Given two sessions, one created 30 minutes ago and one created 2 hours ago, when the runner runs, then only the 2-hour-old one is processed.
2. Given a session to be cleaned, the SQLite delete is called BEFORE `rm` (verified by spy ordering).
3. `rm` uses `{ recursive: true, force: true }`.
4. Given the SQLite delete throws for one session, then the loop logs `Logger.error` and continues with the next.
5. After advancing the clock by 2 hours, the previously-young session becomes eligible.

## Tooling
- Framework: jest, fs/promises
- Runner: `nx test backend --testPathPattern=multipart-cleanup.runner.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6442–6443), §4.4.4 (lines 6023–6029)
