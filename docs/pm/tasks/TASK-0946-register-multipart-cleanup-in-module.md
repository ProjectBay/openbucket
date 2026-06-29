---
id: TASK-0946
title: Register MultipartCleanupRunner in BackgroundModule and wire BackgroundService
story: STORY-0315
status: done
type: infra
size: XS
---

## Description
Add `MultipartCleanupRunner` to `BackgroundModule` providers and confirm `BackgroundService.onApplicationBootstrap` schedules it at the `5 * 60_000` ms interval.

## Files to create / modify
- `apps/backend/src/common/background/background.module.ts` — modify

## Implementation notes
- Already required by `BackgroundService` constructor (§4.9 line 6248).

## Acceptance criteria
- [ ] `MultipartCleanupRunner` is a provider in `BackgroundModule`.
- [ ] After bootstrap, `BackgroundService` schedules `multipart-cleanup` at `5 * 60_000` ms.

## Test obligations
- Unit: covered by [TEST-0321]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0945], [TASK-0939]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6248, 6259)
