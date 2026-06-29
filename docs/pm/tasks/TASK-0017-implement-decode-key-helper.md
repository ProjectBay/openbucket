---
id: TASK-0017
title: Implement decodeKey helper
story: STORY-0007
status: done
type: implementation
size: XS
---

## Description
Implement `decodeKey(pathSegment: string): string` in `request-classifier.middleware.ts` per §1.5. Wraps `decodeURIComponent` in `try/catch`; on malformed percent-encoding returns the raw segment unchanged so the S3 controller can surface `InvalidURI`.

## Files to create / modify
- `apps/openbucket-backend/src/common/middleware/request-classifier.middleware.ts` — modify

## Implementation notes
- Quote §1.5 (lines 479–486):
  ```ts
  function decodeKey(pathSegment: string): string {
    try {
      return decodeURIComponent(pathSegment);
    } catch {
      // Malformed percent-encoding. Return raw; the S3 controller surfaces InvalidURI.
      return pathSegment;
    }
  }
  ```

## Acceptance criteria
- [ ] `decodeKey('a%20b') === 'a b'`.
- [ ] `decodeKey('bad%2') === 'bad%2'` (no throw).
- [ ] `decodeKey('') === ''`.

## Test obligations
- Unit: covered by [TEST-0007]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.5 (lines 479–486)
