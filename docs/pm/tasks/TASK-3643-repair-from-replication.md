---
id: TASK-3643
title: Repair corrupt blobs from the replication target
story: STORY-1204
status: backlog
type: implementation
size: M
---

## Description
When the scrubber marks a blob `corrupt` AND a replication target is configured, fetch the
good remote copy, stage it through `BlobStore`'s two-phase writer, re-verify it against the
stored `contentSha256`, atomically replace the local blob, and flip the row back to `ok`.
Repair is a no-op (leave the row `corrupt`) when no target is configured.

## Files to create / modify
- `libs/nestjs/src/lib/storage/integrity-repair.service.ts` — new
- `libs/nestjs/src/lib/storage/replication/replication-target.service.ts` — modify (add a raw-key `getReplicated(key)` seam)
- `libs/nestjs/src/lib/common/background/integrity-scrub.runner.ts` — modify (call repair on a corrupt verdict)
- `libs/nestjs/src/lib/storage/storage.module.ts` — modify (provide `IntegrityRepairService`)

## Implementation notes
- Remote fetch seam: async replication (STORY-0900) writes objects under their RAW key on the
  target (the tiering `TIER_PREFIX` path is separate). `ReplicationTargetService` already holds
  the client + `get()` for the tiered prefix; add a sibling that reads the raw replicated key:
  ```ts
  async getReplicated(key: string, opts?: { signal?: AbortSignal }): Promise<RemoteGetResult> {
    const client = this.requireClient();
    const out = await client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: opts?.signal });
    return { stream: out.Body as Readable, contentLength: out.ContentLength, contentType: out.ContentType };
  }
  ```
  (The replicated remote copy is PLAINTEXT — replication decrypts SSE before upload — so the
  digest lines up directly with the stored `contentSha256`.)
- Repair service:
  ```ts
  @Injectable()
  export class IntegrityRepairService {
    constructor(private readonly target: ReplicationTargetService,
                private readonly blobs: BlobStore,
                private readonly verifier: IntegrityVerifier,
                private readonly em: EntityManager) {}
    async repair(o: ObjectEntity): Promise<'repaired' | 'skipped-no-target' | 'failed'>;
  }
  ```
  Steps:
  1. `if (!this.target.enabled) return 'skipped-no-target';`
  2. Stream `target.getReplicated(o.key)` into `blobs.putBlob(bucket, key, remoteStream, cipher?, maxSize)`
     — reuse the EXISTING two-phase writer (tmp → fsync → atomic rename), so a partial/failed
     fetch never leaves a half-written blob in place. Pass the SSE `cipher` when `o.encryption`
     is set so the re-fetched plaintext is re-encrypted to the same at-rest form; cap with
     `maxSize = o.size` (defence against a divergent remote object — reuse `MaxBlobSizeExceededError`).
  3. `putBlob` returns the recomputed `sha256`; assert it `=== o.contentSha256`. If it does NOT
     match, the remote copy is ALSO bad — discard the staged blob is already handled by putBlob's
     rename (we then restore/undo): treat as `failed`, leave the row `corrupt`, DO NOT overwrite.
     (Use `blobs.backupCurrentBlob` before the rename so a bad remote can be rolled back — the
     same F2/F3 overwrite-safety primitives.)
  4. On success: `nativeUpdate` the row to `integrityStatus='ok'`, `integrityCheckedAt=now`,
     `integrityDetail='repaired from replication target'`, and bump `scrub_state.repaired`.
- Runner wiring: in `IntegrityScrubRunner`, after marking a verdict `corrupt`, call
  `await this.repair.repair(o)` inside the per-object try/catch. Repair failures are isolated
  (logged redacted, cursor advances) exactly like `tiering-sweep`'s per-object catch.
- Edge cases:
  - Remote key missing (never replicated / since deleted) → `getReplicated` throws NoSuchKey →
    `failed`, row stays `corrupt` (operator must restore from backup instead).
  - Object under active object-lock retention → repair only rewrites BYTES, never the row/lock,
    so lock enforcement is unaffected (same invariant `tiering.service` relies on).
  - Concurrency: hold the per-key write lock if one is exposed; otherwise `putBlob`'s atomic
    rename + `backupCurrentBlob` keep a racing overwrite safe (last-rename-wins).
- Security/DoS: never log/return the remote endpoint or credentials — reuse the runner's
  `redact()` for any repair error string. The `maxSize` cap and single-object-at-a-time repair
  (inside the already-throttled tick) bound remote egress and disk write amplification.

## Acceptance criteria
- [ ] With a target configured and a locally-corrupted blob whose remote copy is intact, one scrub tick repairs it: on-disk bytes match `contentSha256` again and the row flips to `ok`.
- [ ] With NO target configured, a corrupt blob stays `corrupt` and no remote call is attempted (`repair` returns `skipped-no-target`).
- [ ] A remote copy that also fails the digest check leaves the local blob unchanged and the row `corrupt` (no bad overwrite).
- [ ] `nx test nestjs --testPathPattern=integrity-repair` passes.

## Test obligations
- Unit: covered by [TEST-1204] (repair success / no-target / bad-remote rollback)
- E2E: covered by [TEST-1204] (end-to-end corrupt → repair with a fake S3 target)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3640], [TASK-3641], [TASK-3642], [STORY-0900] (replication target)
