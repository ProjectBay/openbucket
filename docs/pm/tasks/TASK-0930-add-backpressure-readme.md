---
id: TASK-0930
title: Add backpressure README under apps/backend/src/s3/object/
story: STORY-0311
status: done
type: docs
size: XS
---

## Description
Create `apps/backend/src/s3/object/README.md` containing the §4.7 invariant statement and the "never" list, so engineers touching this directory see the rules before they regress them.

## Files to create / modify
- `apps/backend/src/s3/object/README.md` — new

## Implementation notes
- Quote verbatim from §4.7:
  - "We never call `req.on('data', ...)` directly on the request — that switches the stream into flowing mode and bypasses backpressure entirely."
  - "We never accumulate chunks into an in-memory `Buffer[]` and concatenate at end — that's how Express's default body-parser works, and it's why we disabled it."
  - "We never `await` something inside a `_transform` that isn't tied to the chunk being processed — that gives the Transform's queue an unbounded growth path because it can't apply backpressure to itself."
- Quote the invariant: "at any moment, the maximum buffered bytes per in-flight PUT is roughly (TCP recv buf) + 256 KB (verifier) + 256 KB (writable) ≈ 1 MiB".

## Acceptance criteria
- [ ] README exists with all three "never" rules quoted verbatim.
- [ ] README states the ≈ 1 MiB ceiling per in-flight PUT.
- [ ] README references `§4.7`.

## Test obligations
- Unit: N/A — pure docs
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0929]

## References
- `docs/WHITEPAPER.md` §4.7 (lines 6165–6172)
