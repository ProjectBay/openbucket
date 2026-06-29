---
id: TASK-0360
title: Implement CORS glob/origin matcher helpers
story: STORY-0117
status: done
type: implementation
size: S
---

## Description
Implement the `matchOrigin`, `matchHeader`, and `globMatch` helper functions used by `CorsController.preflight`.

## Files to create / modify
- `apps/backend/src/s3/cors/cors.controller.ts` — modify (private helpers)

## Implementation notes
- Verbatim from §2.9 (lines 2664–2678):
  ```ts
  function matchOrigin(allowed: string[], origin: string): boolean {
    return allowed.some((pattern) => globMatch(pattern, origin));
  }
  function matchHeader(allowed: string[], header: string): boolean {
    return allowed.some((pattern) => globMatch(pattern.toLowerCase(), header));
  }
  function globMatch(pattern: string, candidate: string): boolean {
    // AWS supports a single '*' wildcard anywhere in the pattern.
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return pattern === candidate;
    const star = pattern.indexOf('*');
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    return candidate.startsWith(head) && candidate.endsWith(tail);
  }
  ```

## Acceptance criteria
- [ ] `globMatch('*', anything)` → true.
- [ ] `globMatch('https://*.example.com', 'https://app.example.com')` → true.
- [ ] `globMatch('https://example.com', 'https://other.com')` → false.

## Test obligations
- Unit: covered by [TEST-0131]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2664–2678)
