---
id: TASK-0036
title: Implement setHeaders cache-control branches
story: STORY-0013
status: done
type: implementation
size: XS
---

## Description
Implement the `setHeaders(res, path)` callback in `SpaModule` per §1.9 with three branches: (1) `index.html` → no-cache trio, (2) hashed assets matching `/\.[0-9a-f]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/i` → `Cache-Control: public, max-age=31536000, immutable`, (3) otherwise → `Cache-Control: public, max-age=300`.

## Files to create / modify
- `apps/openbucket-backend/src/spa/spa.module.ts` — modify

## Implementation notes
- Quote §1.9 (lines 893–904) verbatim:
  ```ts
  setHeaders: (res, path) => {
    if (path.endsWith('/index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (/\.[0-9a-f]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/i.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  },
  ```

## Acceptance criteria
- [ ] `index.html` response has the three no-cache headers.
- [ ] Hashed asset response has `Cache-Control: public, max-age=31536000, immutable`.
- [ ] Other static file (e.g. `favicon.ico`) has `Cache-Control: public, max-age=300`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0014]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0035]

## References
- `docs/WHITEPAPER.md` §1.9 (lines 893–916)
