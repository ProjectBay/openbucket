---
id: TASK-0950
title: Implement OrphanScanRunner directory walk
story: STORY-0317
status: done
type: implementation
size: S
---

## Description
Create `apps/backend/src/common/background/orphan-scan.runner.ts` with an `@Injectable()` `OrphanScanRunner` class. Implement a directory walk of `<dataDir>/blobs/` that yields each blob's `{ bucket, key, path }` triple.

## Files to create / modify
- `apps/backend/src/common/background/orphan-scan.runner.ts` — new

## Implementation notes
- Use `fs/promises.readdir(..., { withFileTypes: true })` and recurse.
- The first directory level under `blobs/` is the bucket; the rest is the encoded key (key encoding lives in EPIC-03; for orphan-scan purposes we look up by path, not by decoded key).
- Yield with `setImmediate` between subdirectories to keep the event loop responsive.

## Acceptance criteria
- [ ] Function enumerates every regular file under `<dataDir>/blobs/`.
- [ ] Walker yields between directories via `setImmediate`.

## Test obligations
- Unit: covered by [TEST-0323]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6253–6261), glossary "Orphan blob"
