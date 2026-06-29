---
id: TEST-0001
title: Backend scaffold compiles and lints
covers: [STORY-0001, TASK-0001, TASK-0002]
status: done
level: unit
---

## Goal
Verify that the directory tree and empty module placeholders from STORY-0001 produce a buildable, lint-clean Nx project.

## Setup
- Fresh checkout, `npm install` complete.
- No env file required (no `nx serve` invocation).

## Cases
1. Given the scaffold from TASK-0001/TASK-0002, when `nx build openbucket-backend` runs, then it completes with exit code 0.
2. Given the scaffold, when `nx lint openbucket-backend` runs, then it completes with exit code 0.
3. Given the scaffold, when reading each module file in `apps/openbucket-backend/src/{persistence,storage,domain,s3,admin}/`, then each exports a class decorated `@Module({})`.

## Tooling
- Framework: jest (project linter for case 3 uses a tiny custom AST check)
- Runner: `nx build openbucket-backend`, `nx lint openbucket-backend`

## Pass criteria
- [ ] `nx build openbucket-backend` exits 0.
- [ ] `nx lint openbucket-backend` exits 0.
- [ ] All five placeholder modules export an empty `@Module({})` class.

## References
- `docs/WHITEPAPER.md` §1.1 (lines 53–122)
