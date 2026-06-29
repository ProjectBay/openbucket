---
id: TEST-0419
title: Frontend scaffold builds
covers: [STORY-0414, TASK-1241, TASK-1242, TASK-1243, TASK-1246]
status: done
level: unit
---

## Goal
Verify the SPA scaffold compiles and `index.html` carries the `<base href="/admin/">` so static-serving works.

## Setup
- Clean workspace state. Run `nx build frontend`.

## Cases
1. `nx build frontend` exits 0.
2. `dist/apps/frontend/index.html` contains `<base href="/admin/">`.
3. `dist/apps/frontend/main-<hash>.js` exists.
4. No `process.env.NG_DEPRECATED` warnings about NgModule (every component is `standalone: true`).
5. `app.config.ts` provider list includes (in order) `provideZoneChangeDetection`, `provideRouter`, `provideHttpClient`, `provideApiClient` (verified by source-grep, since this is a scaffold check).

## Tooling
- Framework: jest (build assertions) + nx CLI
- Runner: `nx build frontend && nx test frontend --testPathPattern=scaffold.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.10 (lines 7747–7825), §5.11 (lines 7913–7924)
