---
id: TEST-0005
title: Express.Request augmentation surfaces typed req.openbucket
covers: [STORY-0005, TASK-0011, TASK-0012]
status: done
level: unit
---

## Goal
Verify that the `request.d.ts` module augmentation makes `req.openbucket` strongly typed throughout the backend without explicit imports at use sites.

## Setup
- A TypeScript compilation test using `tsc --noEmit` against the backend project, plus a small spec file that consumes `req.openbucket` in multiple paths.

## Cases
1. Given a controller file that types `req: Request` from `'express'` and accesses `req.openbucket.requestId`, when the project is type-checked, then there are no `Property 'openbucket' does not exist` errors.
2. Given a usage `req.openbucket.kind = 'banana'`, when the project is type-checked, then TypeScript emits an error (union narrowing works).
3. Given the augmentation, when imported in a different file via `import type { OpenBucketRequestContext }`, then the exported type contains the eight fields documented in §1.4.

## Tooling
- Framework: jest + ts-morph (for case 3); `tsc --noEmit` invoked via `nx build openbucket-backend --skip-nx-cache`.
- Runner: `nx build openbucket-backend`

## Pass criteria
- [ ] Project compiles without explicit imports of `request.d.ts`.
- [ ] Union mismatches surface as compile errors.

## References
- `docs/WHITEPAPER.md` §1.4 (lines 345–382)
