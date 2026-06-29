---
id: STORY-0315
title: MultipartCleanupRunner tick
epic: EPIC-04
status: done
size: S
risk: low
---

## User story
As an operator, I want abandoned multipart sessions reaped after a TTL, so that orphaned part directories from crashed clients or partial aborts do not accumulate on disk.

## Description
Implement `apps/backend/src/common/background/multipart-cleanup.runner.ts`. The runner scans `multipart_uploads` for rows whose `createdAt` is older than `MULTIPART_TTL_HOURS` (driven by `ConfigService`, default per the white paper: a reasonable single-day window — quote the §4.9 elision: "scans `multipart_uploads` for rows older than `MULTIPART_TTL_HOURS`, drops the SQLite rows and `rm -rf`s the directory"). For each expired row it deletes the SQLite row inside a transaction, then `rm -rf` the `multipart/<uploadId>/` directory (`rm(..., { recursive: true, force: true })`). The runner uses the injected `Clock` for "now" so tests can advance time. Scheduled by `BackgroundService` every `5 * 60_000` ms.

## Acceptance criteria
- [x] Runner reads `MULTIPART_TTL_HOURS` from `ConfigService` (with a sensible default).
- [x] Runner enumerates expired sessions using `MultipartService` query (or repository) bounded by `clock.nowMs() - ttlMs`.
- [x] For each expired session, the SQLite row is deleted before the filesystem rm.
- [x] Filesystem cleanup uses `rm(..., { recursive: true, force: true })`.
- [x] Errors on a single session do not abort the loop (logged and continue).
- [x] `nx test backend --testPathPattern=multipart-cleanup.runner.spec.ts` passes with TestClock.

## Tasks
- [TASK-0944] Implement MultipartCleanupRunner skeleton + Clock + ConfigService injection
- [TASK-0945] Implement expired-session enumeration and per-session row+fs cleanup
- [TASK-0946] Register MultipartCleanupRunner in BackgroundModule and wire BackgroundService

## Test plan
- [TEST-0321] MultipartCleanupRunner unit tests with TestClock

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0313], [STORY-0318]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6205–6326), §4.4.4 (lines 5994–6032)
- Interfaces consumed: `MultipartService` (defined in [EPIC-03]), `ConfigService.dataDir/multipartTtlHours` (defined in [EPIC-01]), `Clock.nowMs` (defined in [STORY-0318])
- Interfaces produced: `MultipartCleanupRunner`
