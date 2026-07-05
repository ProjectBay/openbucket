---
id: TEST-1204
title: Integrity scrub — detection, throttling, repair, and admin/console surfacing
covers: [STORY-1204, TASK-3640, TASK-3641, TASK-3642, TASK-3643, TASK-3644]
status: backlog
level: e2e
---

## Goal
Verify that the background scrubber detects at-rest corruption by re-hashing blobs against the
stored `contentSha256`, stays strictly rate-limited (default-off, bounded per tick, resumable),
repairs a corrupt blob from a replication target when one is configured, and surfaces corruption
through the admin API and console indicator — all without leaking any target credential/endpoint.

## Setup
- Fixtures: a booted NestJS test app (in-memory/temp `DATA_DIR`) with `IntegrityVerifier`,
  `IntegrityScrubRunner`, `IntegrityRepairService`, and the integrity admin module wired.
- Seed: a bucket with N objects written through the normal PUT path so each row has a real
  `contentSha256`; one SSE-encrypted object (to exercise `createSseDecipher`); one tiered object
  (`location != 'local'`) and one soft-deleted object (must be skipped).
- Corruption helper: flip a byte in a blob file on disk via its `PathResolver.blobPath` (does not
  touch the DB row, so the stored digest still describes the original bytes).
- Replication: a fake S3 target (e.g. an in-process `@aws-sdk/client-s3` mock or a local S3
  double) preloaded with the GOOD copy of the object under its raw key; plus a run with the
  target disabled and a run where the remote copy is ALSO corrupt.
- Env toggles: `OB_INTEGRITY_SCRUB_ENABLED`, `OB_INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK`,
  `OB_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK`, `OB_REPLICATION_ENABLED`.

## Cases
1. Default-off: with `OB_INTEGRITY_SCRUB_ENABLED` unset, invoking `run()` performs zero
   `scanForScrub`/`getBlob` calls (asserted via spies) and writes nothing to the DB.
2. Verifier ok/corrupt/SSE: `IntegrityVerifier.verify` returns `ok:true` for an intact blob,
   `ok:false` with the recomputed digest for a byte-flipped blob, and correctly decrypts +
   hashes plaintext for the SSE object; ENOENT propagates (not reported as corrupt).
3. Detection: enable the scrub, run one tick over the seeded bucket — the intact rows become
   `integrityStatus='ok'` with `integrityCheckedAt` set; the corrupted row becomes `'corrupt'`
   with a bounded, redacted `integrityDetail`.
4. Skips: the tiered object (`location='remote'`), the soft-deleted object, and any row with a
   null `contentSha256` are never hashed and stay `unchecked`.
5. Throttle + resume: with `MAX_OBJECTS_PER_TICK=2` and >2 objects, a single tick hashes exactly
   2, persists a non-null cursor to `scrub_state`, and returns; a second tick resumes past the
   cursor and eventually resets the cursor to null on a completed pass. The byte-budget variant
   (`MAX_BYTES_PER_TICK` small) stops mid-pass the same way.
6. Non-starvation smoke: a tick over a large seed yields (`setImmediate`) between batches — a
   concurrently-issued GET resolves while the tick is running (no event-loop starvation).
7. Read gate still fires (F1): independent of the scrub, `GetObject` on the corrupted blob 500s
   via the existing `verifyBlobIntegrity` path (corruption is never served).
8. Repair (happy path): with the target enabled and the good copy present, running the tick over
   the corrupt object rewrites the on-disk bytes (digest matches `contentSha256` again), flips the
   row to `'ok'`, bumps `scrub_state.repaired`, and leaves object-lock/row metadata untouched.
9. Repair — no target: with replication disabled, the corrupt row stays `'corrupt'`, `repair`
   returns `skipped-no-target`, and no S3 call is made.
10. Repair — bad remote: when the remote copy also fails the digest check, the local blob is NOT
    overwritten (rolled back via `backupCurrentBlob`) and the row stays `'corrupt'`.
11. Manual trigger: `POST /api/admin/integrity/scrub` returns 202, emits an
    `integrity.scrub.started` audit event, and causes a scan on the next tick without bypassing
    the per-tick budget.
12. Admin API shape + authz: `GET /api/admin/integrity/status` returns
    `{ enabled, scanned, ok, corrupt, unchecked, repaired, lastRunAt, cursor }`;
    `GET /api/admin/integrity/corrupt` is paged, `limit`-capped at 200, and lists the seeded
    corrupt object; both reject an unauthenticated request (401) via `JwtAuthGuard`.
13. Secret non-leak: a forced remote-fetch failure produces an `integrityDetail`/job error and
    log line with NO endpoint, bucket, or access-key substring; the `status`/`corrupt` responses
    and (if present) `/metrics` output contain only counts/keys, never credentials.
14. Console indicator: the Angular `IntegritySignalStore` exposes `corrupt > 0` after refresh and
    the sidebar badge renders the count and hides when `corrupt === 0`.

## Tooling
- Framework: jest + supertest (admin routes), `@aws-sdk/client-s3` mock (repair), Angular
  TestBed (signal store)
- Runner: `nx test nestjs`, `nx e2e openbucket-backend-e2e`, `nx test openbucket-frontend`

## Pass criteria
- [ ] Cases 1–14 pass.
- [ ] Default-off run touches neither disk nor DB (case 1).
- [ ] Corruption is detected and, with a target, repaired; without a target it is reported not healed (cases 3, 8, 9, 10).
- [ ] No integrity route, log line, audit payload, or `/metrics` sample contains a remote endpoint/credential (case 13).
- [ ] The scrub is demonstrably bounded and resumable per tick (cases 5, 6).

## References
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `verifyBlobIntegrity` (F1 gate reused by TASK-3640)
- `libs/nestjs/src/lib/common/background/tiering-sweep.runner.spec.ts` — throttle/cursor spec to model after
- `libs/nestjs/src/lib/common/background/reconcile.runner.ts` — `redactError` secret-scrub pattern (case 13)
- `libs/nestjs/src/lib/storage/blob-store.ts` — `PathResolver.blobPath` (corruption helper), two-phase writer (repair)
