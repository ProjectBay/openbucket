---
id: TASK-0947
title: Implement TrashPurgeRunner skeleton with Clock injection
story: STORY-0316
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/background/trash-purge.runner.ts` with an `@Injectable()` `TrashPurgeRunner` class. Inject `Clock`, `BlobStore`, and the trash repository / `ObjectService`. Expose `async run(): Promise<void>`.

## Files to create / modify
- `apps/backend/src/common/background/trash-purge.runner.ts` — new

## Implementation notes
- §4.9 description: "scans `trash/` entries whose `expires_at < now`, unlinks the blob, removes the trash row."
- "now" comes from `Clock.now()` so tests can advance time deterministically.

## Acceptance criteria
- [ ] Class compiles with `Clock`, `BlobStore`, and the trash repository injected.
- [ ] `run()` returns a `Promise<void>`.

## Test obligations
- Unit: covered by [TEST-0322]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0953]

## References
- `docs/WHITEPAPER.md` §4.9 (line 6444)
