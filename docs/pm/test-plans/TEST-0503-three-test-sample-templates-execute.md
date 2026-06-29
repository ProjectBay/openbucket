---
id: TEST-0503
title: Three test-sample templates execute
covers: [STORY-0505, TASK-1550, TASK-1551, TASK-1552]
status: done
level: e2e
---

## Goal
Verify that each of the three test-sample templates (unit, e2e, conformance) actually runs end-to-end against the real implementations. The samples themselves serve as templates for other Epics' Test Plans, so they must be live and green — not skeletons.

## Setup
- Clean checkout, `npm ci` complete, Node 22.
- For the conformance sample, Docker available and a built `openbucket:local` image (or `OPENBUCKET_IMAGE` set).
- Backend implementations exist: `BucketService` ([EPIC-03]), `AppModule` ([EPIC-01]), admin-auth surface ([EPIC-05]).

## Cases
1. **Unit sample runs ([TASK-1550]).** Given the `BucketService` implementation, when `nx test backend --testPathPattern=bucket.service.spec.ts` runs, then all three `it()` blocks pass (creates with default versioning, rejects duplicate names, refuses to delete a non-empty bucket).
2. **In-memory SQLite isolation.** Given two consecutive invocations of the unit sample, when both run, then each suite gets a fresh `:memory:` database (no row carries across; `afterEach` `orm.close(true)` is honored).
3. **E2E sample runs ([TASK-1551]).** Given the admin-auth surface, when `nx run backend-e2e:e2e --testPathPattern=admin-auth` runs with `DATA_DIR` and `JWT_SECRET` from the e2e job's env, then both `it()` blocks pass (login + refresh + reuse-detection chain; bearer-token protection on `/me`).
4. **Ephemeral data dir.** Given the e2e sample's `mkdtempSync(join(tmpdir(), 'ob-e2e-'))` block, when the suite finishes, then the temp dir is left on disk (Jest does not delete it) but does not collide across runs (unique per `mkdtempSync` invocation).
5. **Conformance sample runs ([TASK-1552] / [TASK-1541]).** Given a built `openbucket:local` image, when `nx run conformance:e2e --testPathPattern=object-roundtrip` runs locally, then the suite boots the container, completes the 4 MiB roundtrip, and stops the container in `afterAll`.

## Tooling
- Framework: jest; supertest for e2e; `testcontainers` + `@aws-sdk/client-s3` for conformance.
- Runner:
  - Unit: `nx test backend --testPathPattern=bucket.service.spec.ts`
  - E2E: `nx run backend-e2e:e2e --testPathPattern=admin-auth`
  - Conformance: `nx run conformance:e2e --testPathPattern=object-roundtrip`

## Pass criteria
- [ ] All three samples pass against the real implementations at the time other Epics' Test Plans reference them.
- [ ] Each sample's conventions (in-memory SQLite per suite; `mkdtempSync` data dir; `testcontainers` for the conformance level) are demonstrably exercised — not bypassed.

## References
- `docs/WHITEPAPER.md` §5.20 (lines 8738–8947)
- `docs/BACKEND-DESIGN.md` §7, §9
