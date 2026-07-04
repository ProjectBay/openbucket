---
id: TASK-2711
title: Implement the cold-object selection policy and tiering sweep runner
story: STORY-0901
status: backlog
type: implementation
size: L
---

## Description

Add the background machinery that offloads cold objects. A `TieringSweepRunner`
(a `ScheduledTask`, 60s tick) pages current, local, non-deleted objects per
transition rule via a cursor — exactly like `LifecycleSweepRunner` — selects
those whose last access is older than the rule window, uploads each plaintext
blob to the STORY-0900 remote, confirms durability, then removes the local blob
and flips the row to a remote stub in one transaction. Cold selection and the
offload seam live in the domain layer so the runner stays thin.

## Files to create / modify

- `libs/nestjs/src/lib/common/background/tiering-sweep.runner.ts` — new
  (mirror `lifecycle-sweep.runner.ts`)
- `libs/nestjs/src/lib/domain/lifecycle/lifecycle.service.ts` — modify (add
  `activeTransitionRules()` + reuse `loadCursor`/`saveCursor` against `tiering_state`)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (add
  `scanForTiering(...)` and `tierToRemote({ em, bucket, key, storageClass })`)
- `libs/nestjs/src/lib/domain/tiering/tiering.service.ts` — new (offload
  orchestration: stream local→remote, verify, swap to stub)
- `libs/nestjs/src/lib/common/background/tiering-sweep.runner.spec.ts` — new

## Implementation notes

- Runner shape copies `LifecycleSweepRunner` verbatim (name `'tiering-sweep'`,
  `intervalMs = 60_000`, `BATCH_SIZE = 500`, `MAX_BATCHES_PER_TICK`, `setImmediate`
  yield, `Clock` for test fast-forward, one transaction per batch). It is a no-op
  when no remote is configured (TASK-2713 gates via `OPENBUCKET_TIER_ENABLED` +
  the injected `RemoteObjectStore` being present).
- `activeTransitionRules()` mirrors `activeExpirationRules()`: flatten each
  bucket's `lifecycle` rules where `status === 'Enabled' && transitionDays != null`,
  emit `{ ruleId: '${bucket}/${rawId}', bucket, prefix, days, storageClass }`.
  Reuse the same `${bucket}/${ruleId}` composite-cursor scheme and `splitRuleId`.
- Cold predicate (in the runner, reading `Clock`): an object is cold when
  `location === Local` and `(lastAccessedAt ?? modifiedAt)` is older than
  `days * 86_400_000` ms. `scanForTiering` extends `scanForLifecycle` to also
  return `location`, `size`, `lastAccessedAt`, `modifiedAt` so the predicate needs
  no extra query.
- `TieringService.tierToRemote(em, bucket, key, storageClass)` — the durable
  swap. **Ordering is the safety property (no data-loss window):**
  1. `remoteKey = encodeKey(key)` (key-codec — path-safe, not client-steerable).
  2. Open the *decrypted* plaintext stream exactly as `openObjectStream` does
     (honour `obj.encryption` via `createSseDecipher`) and `RemoteObjectStore.putObject(bucket, remoteKey, stream, { contentType, contentLength: size })`.
  3. `RemoteObjectStore.headObject` and assert the returned size/etag (or
     recompute sha256) matches the row's `contentSha256`/`size` — refuse to
     proceed on mismatch (leave the object LOCAL, log, count a failure).
  4. Only then, inside `em.transactional`: set `location = Remote`,
     `remoteKey`, `tieredAt = now`, `storageClass = <target>`, persist, and
     `blobs.deleteBlob(bucket, key)` (soft-delete to trash, so the local copy is
     still recoverable during the trash grace window — an extra safety net).
  If the process dies between 3 and 4 the object is simply still LOCAL and gets
  retried next tick (idempotent: re-PUT to the same `remoteKey` overwrites).
- Signatures:
  ```ts
  interface TransitionRule extends Omit<ExpirationRule,'days'|'date'> {
    days: number; storageClass: StorageClass;
  }
  async tierToRemote(i: { em: EntityManager; bucket: string; key: string;
    storageClass: StorageClass }): Promise<'tiered' | 'skipped'>;
  ```
- Edge cases / security / DoS: honour `freeSpace.assertWritable()` is **not**
  needed for offload (it frees space), but the *upload* must be size-capped by
  `MAX_OBJECT_SIZE_MB` semantics already on the row; never tier an object under
  object-lock legal-hold/retention differently — tiering only moves bytes, the
  row + lock stay, so GET still enforces lock on delete (no regression). Skip
  objects with `softDeleted`, active multipart, or `location !== Local`. Cap the
  number of concurrent uploads per tick to avoid saturating egress/remote
  (sequential within a batch is fine given the 500-row batch + tick model). A
  remote outage must not wedge the sweep: catch per-object, log, leave LOCAL, move
  the cursor forward so one poisoned key can't stall the rule (matches the
  lifecycle runner's resilience).

## Acceptance criteria

- [ ] `nx test nestjs --testPathPattern=tiering-sweep.runner.spec` passes: a rule
      with `transitionDays` offloads only objects older than the window, leaves
      warm objects LOCAL, and advances the cursor.
- [ ] After a sweep tiers a key, the local blob is gone (in trash) and the row is
      `location='remote'` with a non-null `remoteKey` and the target `storageClass`.
- [ ] With no `RemoteObjectStore` configured the runner is a no-op (no rows change).
- [ ] A simulated remote HEAD mismatch leaves the object LOCAL and increments a
      logged failure — the local blob is never deleted.

## Test obligations

- Unit: covered by [TEST-0901] (sweep + `tierToRemote` cases)
- E2E: covered by [TEST-0901] (tier-then-GET round trip)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2710], [TASK-2713], [STORY-0900]
