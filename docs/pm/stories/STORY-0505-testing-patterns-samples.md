---
id: STORY-0505
title: Testing patterns — unit, e2e, and conformance sample templates
epic: EPIC-06
status: done
size: M
risk: low
---

## User story
As a developer writing a Test Plan for another Epic, I want canonical sample tests for each of the three test levels (unit with in-memory SQLite, e2e with supertest and a real Nest app, conformance with `testcontainers` + AWS SDK), so that I can copy a working pattern instead of re-deriving fixtures, env wiring, and ORM lifecycle each time.

## Description
Land the three sample tests verbatim from §5.20 as living templates that other Epics' Test Plans reference: `bucket.service.spec.ts` (unit; boots MikroORM against `:memory:` per suite, does *not* mock the EntityManager — see `BACKEND-DESIGN.md` §7.1), `admin-auth.e2e-spec.ts` (e2e; spins `AppModule` via `Test.createTestingModule`, configures `DATA_DIR` to a `mkdtempSync` dir, hashes the admin password with argon2id, exercises login + refresh + reuse-detection), and `object-roundtrip.conformance.ts` (conformance; boots the container via `testcontainers`, points `@aws-sdk/client-s3` at it, PUT/GET/DELETE on a 4 MiB payload). The CLI-matrix conformance suites (`aws-cli`, `mc`, `s3cmd`) are owned by [STORY-0504]; this Story is the SDK-based sample.

## Acceptance criteria
- [ ] `apps/backend/src/domain/buckets/bucket.service.spec.ts` exists and contains the unit pattern from §5.20.1.
- [ ] `apps/backend-e2e/src/admin-auth.e2e-spec.ts` exists and contains the e2e pattern from §5.20.2.
- [ ] `apps/conformance/src/object-roundtrip.conformance.ts` exists and contains the conformance pattern from §5.20.3.
- [ ] Each sample is executable: `nx test backend --testPathPattern=bucket.service.spec.ts`, `nx run backend-e2e:e2e --testPathPattern=admin-auth`, and `nx run conformance:e2e --testPathPattern=object-roundtrip` each pass against the real implementations.
- [ ] The three sample files are referenced by name in the Test Plans of other Epics that adopt these patterns.

## Tasks
- [TASK-1550] Land the unit-test sample (`bucket.service.spec.ts`)
- [TASK-1551] Land the e2e-test sample (`admin-auth.e2e-spec.ts`)
- [TASK-1552] Land the conformance-test sample (`object-roundtrip.conformance.ts`)
- [TASK-1553] Document the in-memory SQLite per-suite fixture convention
- [TASK-1554] Document the `mkdtempSync` data-dir + argon2 password-hash convention for e2e

## Test plan
- [TEST-0503] Three test-sample templates execute

## Dependencies
- Blocks: _none directly; consumed as templates by all other Epics' Test Plans_
- Blocked by: [STORY-0504] (for `apps/conformance` skeleton), [STORY-0502] (for `nx run backend-e2e:e2e` wiring)

## References
- `docs/WHITEPAPER.md` §5.20 (lines 8738–8947)
- `docs/BACKEND-DESIGN.md` §7, §9
- Interfaces produced: canonical fixtures and lifecycle conventions for `unit`, `e2e`, `conformance` test levels
- Interfaces consumed: `BucketService` (EPIC-03), `AppModule` (EPIC-01), admin auth surface (EPIC-05), S3 surface (EPIC-02/03/04)

## Verification (2026-06-24)
All three sample templates execute and pass against the real implementations:
- Unit `bucket.service.spec.ts` — passes (backend unit run, Node 20).
- e2e `admin-auth.e2e-spec.ts` — passes (backend e2e run, Node 20).
- Conformance `object-roundtrip.conformance.ts` — **passes** (testcontainers boots `openbucket:local`; 4 MiB SDK round-trip, matching ETag). Verified via a WSL-native Node 22 runner because the Windows-side `nx run conformance:e2e` can't reach the WSL docker network; the test logic + image are identical to the nx target.
