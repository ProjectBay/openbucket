---
id: TASK-1552
title: Land the conformance-test sample (`object-roundtrip.conformance.ts`)
story: STORY-0505
status: done
type: implementation
size: XS
---

## Description
Reference the AWS-SDK conformance sample landed by [TASK-1541] as the canonical conformance template. This Task confirms the file is present at `apps/conformance/src/object-roundtrip.conformance.ts` and is treated as the template other Epics' Test Plans cite when they need a conformance-level pattern.

## Files to create / modify
- _Same file as [TASK-1541]: `apps/conformance/src/object-roundtrip.conformance.ts`. This Task does not duplicate the file; it asserts its role as a template._

## Implementation notes
- See [TASK-1541] for the verbatim sample from §5.20.3.
- The sample is the simplest possible end-to-end exercise: boot container → SDK roundtrip → assert. Other Epics' conformance Test Plans should copy this skeleton (container boot + SDK client construction + a single `it()` per scenario).

## Acceptance criteria
- [ ] `apps/conformance/src/object-roundtrip.conformance.ts` exists (produced by [TASK-1541]).
- [ ] This Task is closed only when at least one other Epic's Test Plan references the file path as its template.

## Test obligations
- Unit: N/A.
- E2E: N/A.
- Conformance: covered by [TEST-0503] (the sample runs end-to-end).

## Dependencies
- Blocked by: [TASK-1541]

## References
- `docs/WHITEPAPER.md` §5.20.3 (lines 8875–8946)
