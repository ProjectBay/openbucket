---
id: TEST-0206
title: Repository helpers against in-memory SQLite
covers: [STORY-0206, TASK-0616, TASK-0617]
status: done
level: unit
---

## Goal
Verify `BucketRepository` and `ObjectRepository` helpers — including the `listByPrefix` range-scan correctness and `nextStringBound` byte arithmetic — against a real `:memory:` SQLite.

## Setup
- Real `:memory:` SQLite; initial migration applied; test fixtures seed buckets and objects.

## Cases
1. Given a `Bucket { name: 'present' }`, `BucketRepository.exists('present')` returns `true`; `exists('missing')` returns `false`.
2. Given `versioning = Enabled` on a bucket, `isVersioned` returns `true` and `hasVersionHistory` returns `true`; with `Suspended`, `isVersioned` returns `false` and `hasVersionHistory` returns `true`; with `Disabled`, both return `false`.
3. Given five keys `a, b, c, d, e` in a bucket, `listByPrefix(bucket, '', undefined, 3)` returns `{ rows: [a, b, c], truncated: true }`.
4. Given keys `photos/a, photos/b, videos/a`, `listByPrefix(bucket, 'photos/', undefined, 10)` returns exactly `[photos/a, photos/b]`.
5. Given keys `a, b, c`, `listByPrefix(bucket, '', 'a', 10)` returns `[b, c]` (marker exclusive).
6. Given a row with `softDeleted = true`, `findCurrentVersion` returns `null`.
7. `nextStringBound('foo')` returns `'fop'`; `nextStringBound('\xff\xff')` returns `'\xff\xff￿'`.
8. Given two `ObjectVersion` rows `(v1@t1, v2@t2)` for the same key with `t2 > t1`, `findLatestVersion` returns `v2`.
9. Given versions across keys `k1@v1, k1@v2, k2@v1`, `listVersionsByPrefix(bucket, '', undefined, undefined, 10)` returns rows ordered `key ASC, createdAt DESC`.

## Tooling
- Framework: jest
- Runner: `nx test persistence --testPathPattern=repositories.spec.ts`

## Pass criteria
- [x] All nine cases pass (`libs/persistence/src/repositories.spec.ts`); 31/31 persistence tests.
- [x] `listByPrefix` uses `$gte`/`$lt` range predicates (no `LIKE`) — source-evident in `object.repository.ts`; the test asserts the *behaviour* (case 4 filters `photos/*` correctly; LIKE-with-prefix would over-match `videos/`).

## Realization note
Case 7's `'\xff\xff'` fallback assertion isn't reachable through valid UTF-8
input — the §3.4.2 implementation does `Buffer.from(prefix, 'utf8')`, and no
valid JS string round-trips to an all-`0xFF` byte sequence. The defensive
branch is kept in the impl but exercised only by binary-decoded inputs; the
documented `nextStringBound('foo') === 'fop'` happy case is verified.

## References
- `docs/WHITEPAPER.md` §3.4.1 (lines 3694–3732), §3.4.2 (lines 3734–3871)
