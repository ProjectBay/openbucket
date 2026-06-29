---
id: TASK-0926
title: Add inline rationale comment for the four server timeouts
story: STORY-0309
status: done
type: docs
size: XS
---

## Description
Add the rationale comment block from §4.5 directly above the four timeout assignments, so a future maintainer reading `main.ts` does not have to chase the white paper to understand the values.

## Files to create / modify
- `apps/backend/src/main.ts` — modify

## Implementation notes
- Reproduce the comment block from §4.5 verbatim (the block beginning `// --- Timeouts (see §4.5) ---` and ending with the `socket idle timeout (server.timeout) = 0` paragraph).

## Acceptance criteria
- [ ] The four timeout assignments are preceded by the full rationale comment block.
- [ ] The block references `§4.5` explicitly.

## Test obligations
- Unit: covered by [TEST-0314]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0925]

## References
- `docs/WHITEPAPER.md` §4.5 (lines 6065–6086)
