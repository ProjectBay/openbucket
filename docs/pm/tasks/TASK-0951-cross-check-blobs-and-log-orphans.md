---
id: TASK-0951
title: Cross-check each blob against ObjectService and log mismatches
story: STORY-0317
status: done
type: implementation
size: S
---

## Description
For each walked file, look up the matching row via `ObjectService` (consumes the EPIC-03 interface — likely a `findByPath` or `headByPath` lookup). Count mismatches and log up to a configurable cap (e.g. 50 sample paths) via `Logger.warn`.

## Files to create / modify
- `apps/backend/src/common/background/orphan-scan.runner.ts` — modify

## Implementation notes
- Quote glossary: "Orphan blob — a file in `blobs/` with no matching row in `objects`. Reconciled (logged, not deleted) by the startup scan."
- Do NOT delete orphans in v1.
- The exact lookup signature is owned by EPIC-03; this Task should consume the name EPIC-03 settles on.

## Acceptance criteria
- [ ] Files with no matching row are counted and a sample (≤ 50 paths) is logged via `Logger.warn`.
- [ ] Runner does not delete any file in v1.

## Test obligations
- Unit: covered by [TEST-0323]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0950]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6253–6261)
