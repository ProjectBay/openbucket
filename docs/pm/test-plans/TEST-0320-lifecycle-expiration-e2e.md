---
id: TEST-0320
title: Lifecycle expiration e2e using advance-clock
covers: [STORY-0314, STORY-0318]
status: backlog
level: e2e
---

## Goal
End-to-end: PUT an object, install a lifecycle rule with `days: 1`, fast-forward the `TestClock` via `/api/admin/_test/advance-clock`, wait for the next sweep, and assert the object is no longer reachable via GET.

## Setup
- Test Nest app booted with `OPENBUCKET_TEST_MODE=1`.
- Lifecycle rule installed via the admin API (or directly via `LifecycleService` for v1 if the admin endpoint is not yet wired).

## Cases
1. PUT object `bucket/k1`; install rule `{ days: 1, bucket, prefix: '' }`. Advance the clock by `86_400_000` ms via `POST /api/admin/_test/advance-clock { ms: 86400000 }`. Wait long enough for the 60s sweep to fire (or trigger directly). GET `bucket/k1` → 404 `NoSuchKey`.
2. PUT object `bucket/k2`; install rule with `date: tomorrow`. Before advance, GET `bucket/k2` → 200. After `advance(86_400_001)`, the next sweep moves it to trash; GET → 404.
3. After expiration, the object's blob file is in trash (not yet purged), not in `blobs/`.

## Tooling
- Framework: supertest, jest
- Runner: `nx e2e backend-e2e --testPathPattern=lifecycle.e2e-spec.ts`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6330–6438), §4.11 (lines 6447–6543)
