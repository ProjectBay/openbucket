---
id: TASK-2712
title: Implement transparent read-through rehydration on GET/HEAD
story: STORY-0901
status: backlog
type: implementation
size: L
---

## Description

Make a tiered (stub) object readable exactly like a local one. On GET/HEAD,
detect `location !== Local` and fetch the bytes back from the STORY-0900 remote
within a bounded latency: stage them via the two-phase `BlobStore`, verify the
F1 integrity digest, flip the row back to `Local`, then serve. Concurrent reads
of the same key rehydrate once (single-flight). Objects above an inline-size cap
are answered with a presigned-URL redirect instead of a proxied fetch. Also stamp
`lastAccessedAt` on every read so the sweep's cold clock is accurate.

## Files to create / modify

- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (`getObject`,
  `headObject`, `openObjectStream`: stub branch + `lastAccessedAt` touch)
- `libs/nestjs/src/lib/domain/tiering/tiering.service.ts` — modify (add
  `rehydrate(bucket, key)` + single-flight map + `redirectUrlFor(...)`)
- `libs/nestjs/src/lib/domain/tiering/tiering.service.spec.ts` — new

## Implementation notes

- Entry gate is unchanged and must stay first: SigV4 + `PolicyAuthorizationGuard`
  (`operationToAction('GetObject')` → `s3:GetObject`) run in the interceptor/guard
  chain *before* `ObjectService.getObject` — so a rehydrate can only ever run for
  an already-authorized principal. Do not add a second authz path.
- In `getObject`, after `findCurrentVersion`, branch on `obj.location`:
  - `Local` → today's path unchanged.
  - `Remote` / `Rehydrating` →
    - If `obj.size > OPENBUCKET_TIER_INLINE_MAX_BYTES` **and** redirect is enabled:
      `res.redirect(307, await tiering.redirectUrlFor(bucket, obj.remoteKey))`
      where the URL is `RemoteObjectStore.presignGet(bucket, remoteKey, ttl)` — a
      short-lived (default 300s) presigned GET. **No static credentials in the
      URL**, and a `Range` request forwards as a `303`/`307` preserving `Range`
      (the remote honours it). Return without touching local disk.
    - Otherwise proxy read-through: `const blob = await tiering.rehydrate(bucket, key)`
      then continue exactly as the local branch (integrity verify + headers +
      stream). Bound the fetch with `OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS`
      (AbortController on the remote GET); on timeout throw a `503 SlowDown`
      (reuse the S3 error taxonomy) so clients retry rather than hang.
- `rehydrate(bucket, key)` — single-flight + durable stage:
  ```ts
  private readonly inflight = new Map<string, Promise<void>>();
  async rehydrate(bucket: string, key: string): Promise<void> {
    const id = `${bucket}/${key}`;
    let p = this.inflight.get(id);
    if (!p) { p = this.doRehydrate(bucket, key).finally(() => this.inflight.delete(id));
              this.inflight.set(id, p); }
    return p;               // N concurrent GETs ⇒ one remote fetch
  }
  ```
  `doRehydrate`: `freeSpace.assertWritable()` first (rehydrate consumes local
  disk — the DoS vector), then stream `RemoteObjectStore.getObject(bucket, remoteKey)`
  into `blobs.putBlob(bucket, key, stream, cipher?, maxSize=size)` (re-encrypt with
  the SSE cipher if the row was encrypted, so at-rest state is preserved and the
  `MaxBlobSizeExceededError` cap guards against a lying remote). Verify the staged
  blob's `contentSha256` matches the row (`verifyBlobIntegrity`) **before** the swap;
  on mismatch unlink the staged blob and throw `500` (never serve unverified bytes
  — F1). Then set `location = Local`, clear `tieredAt`/`remoteKey`, persist.
  Leave `storageClass` as-is or reset to `STANDARD` per policy (document choice).
- `lastAccessedAt`: on every successful GET/HEAD of a `Local` object, best-effort
  update `lastAccessedAt = now` (cheap single-column update; do it after headers
  are sent / off the hot path, and throttle to avoid a write per byte-range poll —
  e.g. skip if updated within the last 60s). This is what makes cold-selection in
  TASK-2711 mean "not *read* recently", not just "not *written* recently".
- Edge cases / security / DoS:
  - Single-flight prevents a thundering-herd of GETs from launching N identical
    multi-GB downloads (remote-egress + local-disk amplification). Additionally cap
    global concurrent rehydrations (`OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE`,
    semaphore) — excess GETs get `503 SlowDown`, composing with the existing
    S3 rate limit (TASK-2141).
  - The inline-size redirect keeps huge objects off the single Node process
    entirely (no proxy memory/fd pressure); presigned URLs are the only path that
    ever leaves the origin, and they are time-boxed + object-scoped.
  - `remoteKey` comes from the row (written via key-codec in TASK-2711), never from
    the request, so a crafted key can't cause SSRF-style access to an arbitrary
    remote object.
  - Rehydrate is bounded by `freeSpace.assertWritable()` + `putBlob`'s `maxSize`
    so a compromised/misbehaving remote can't fill `DATA_DIR` (mirrors TASK-2140).
  - A `Rehydrating` marker row that never completes (crash mid-fetch) is
    self-healing: the row is still a valid stub, so the next GET simply retries.

## Acceptance criteria

- [ ] `nx test nestjs --testPathPattern=tiering.service.spec` passes: GET of a
      stub streams identical bytes + `ETag` as before tiering and passes the F1
      integrity check.
- [ ] Two concurrent GETs of the same stub trigger exactly one
      `RemoteObjectStore.getObject` call (single-flight asserted via a spy).
- [ ] An object above `OPENBUCKET_TIER_INLINE_MAX_BYTES` yields a `307` to a
      presigned URL containing no `AWS4-HMAC` static secret / long-lived credential.
- [ ] A remote that returns truncated/corrupt bytes causes a `500` and leaves no
      partial local blob (staging unlinked); disk is never filled past the guard.
- [ ] After a successful read-through the row is `location='local'` and a
      subsequent GET serves locally with no remote call.

## Test obligations

- Unit: covered by [TEST-0901] (rehydrate, single-flight, integrity, redirect)
- E2E: covered by [TEST-0901] (tier → GET → served identically)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2710], [TASK-2711], [TASK-2713], [STORY-0900]
