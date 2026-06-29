---
id: TEST-0014
title: SPA serving, fallback, and cache headers
covers: [STORY-0013, TASK-0035, TASK-0036]
status: done
level: e2e
---

## Goal
Verify `SpaModule` serves the SPA at `/admin`, falls back to `index.html` for unknown deep links, emits the documented cache headers, and never shadows `/api/admin/*`.

## Setup
- Populate a temporary `dist/spa/` containing:
  - `index.html` with a simple `<app-root></app-root>` body.
  - `main.aaaaaaaa.js` (hashed asset).
  - `favicon.ico` (non-hashed static).
- Boot Nest with `SpaModule` plus a stub `HealthController` (for case 5).

## Cases
1. Given `GET /admin/`, when the server responds, then status 200, body contains `<app-root>`, and headers contain `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0`.
2. Given `GET /admin/main.aaaaaaaa.js`, when the server responds, then status 200 and `Cache-Control: public, max-age=31536000, immutable`.
3. Given `GET /admin/favicon.ico`, when the server responds, then status 200 and `Cache-Control: public, max-age=300`.
4. Given `GET /admin/buckets/abc/objects/123` (no matching file), when the server responds, then status 200 with `index.html` body (router fallback) and the no-cache headers.
5. Given `GET /api/admin/health`, when the server responds, then the SPA is bypassed (the admin controller wins) — status 200 with JSON body, not HTML.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e openbucket-backend-e2e --testPathPattern=spa.e2e.spec`

## Pass criteria
- [x] Case 5 (`/api/admin/health` bypasses the SPA) passes, plus the M0
      no-build guard: `/admin/` does not 5xx and boot/liveness survive a missing
      `dist/spa` (`openbucket-backend-e2e/src/spa.e2e-spec.ts`).
- [ ] Cases 1–4 (no-cache index, immutable hashed asset, max-age static,
      deep-link fallback) — **deferred to EPIC-06**; require a populated
      `dist/spa` (see STORY-0013 Milestone note).

## Realization note
M0 has no SPA build, so this is realized as a spawned-process guard rather than
the planned temp-`dist/spa` fixture: it proves the missing build neither crashes
boot nor 5xxes `/admin/`. The header-assertion cases land with the EPIC-06
conformance image, where a real `dist/spa` exists.

## References
- `docs/WHITEPAPER.md` §1.9 (lines 873–919)
