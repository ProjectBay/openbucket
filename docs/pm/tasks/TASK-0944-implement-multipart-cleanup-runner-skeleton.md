---
id: TASK-0944
title: Implement MultipartCleanupRunner skeleton with Clock + ConfigService injection
story: STORY-0315
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/background/multipart-cleanup.runner.ts` with an `@Injectable()` `MultipartCleanupRunner` class. Inject `MultipartService`, `ConfigService`, and `Clock`. Expose `async run(): Promise<void>`.

## Files to create / modify
- `apps/backend/src/common/background/multipart-cleanup.runner.ts` — new

## Implementation notes
- The §4.9 description elides the body: "scans `multipart_uploads` for rows older than `MULTIPART_TTL_HOURS`, drops the SQLite rows and `rm -rf`s the directory."
- TTL source: `this.config.multipartTtlHours` (or equivalent surface from EPIC-01's `ConfigService`). Default value lives in EPIC-01 — surface it here as `ttlMs = this.config.multipartTtlHours * 60 * 60 * 1000`.

## Acceptance criteria
- [ ] Class compiles with `Clock`, `ConfigService`, `MultipartService` injected.
- [ ] `run()` returns a `Promise<void>`.

## Test obligations
- Unit: covered by [TEST-0321]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0953]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6442–6443)
