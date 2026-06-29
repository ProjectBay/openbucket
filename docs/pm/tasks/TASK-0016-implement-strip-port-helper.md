---
id: TASK-0016
title: Implement stripPort helper
story: STORY-0007
status: done
type: implementation
size: XS
---

## Description
Implement the `stripPort(host: string): string` helper in `request-classifier.middleware.ts` per §1.5. Must handle bracketed IPv6 hosts (`[::1]:9000` → `[::1]`) before falling back to the IPv4/hostname `:port` strip.

## Files to create / modify
- `apps/openbucket-backend/src/common/middleware/request-classifier.middleware.ts` — modify

## Implementation notes
- Quote §1.5 (lines 469–477):
  ```ts
  function stripPort(host: string): string {
    if (host.startsWith('[')) {
      const end = host.indexOf(']');
      return end === -1 ? host : host.slice(0, end + 1);
    }
    const colon = host.indexOf(':');
    return colon === -1 ? host : host.slice(0, colon);
  }
  ```

## Acceptance criteria
- [ ] `stripPort('example.com:9000') === 'example.com'`.
- [ ] `stripPort('[::1]:9000') === '[::1]'`.
- [ ] `stripPort('example.com') === 'example.com'`.

## Test obligations
- Unit: covered by [TEST-0007]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.5 (lines 469–477)
