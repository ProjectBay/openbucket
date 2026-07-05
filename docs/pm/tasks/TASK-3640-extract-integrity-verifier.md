---
id: TASK-3640
title: Extract reusable blob SHA-256 verification into a shared IntegrityVerifier service
story: STORY-1204
status: backlog
type: refactor
size: S
---

## Description
The F1 read-time integrity gate lives as the private `ObjectService.verifyBlobIntegrity`
(re-reads a blob, decrypts SSE if needed, recomputes whole-object SHA-256, throws on
mismatch). The scrubber needs the SAME computation but as a non-throwing, reusable seam
that returns a verdict instead of throwing. Extract the hashing core into a small
`IntegrityVerifier` service in `storage/` so both the read gate and the scrub runner share
one implementation and can never drift.

## Files to create / modify
- `libs/nestjs/src/lib/storage/integrity-verifier.service.ts` — new (extracted core)
- `libs/nestjs/src/lib/storage/storage.module.ts` — modify (provide + export `IntegrityVerifier`)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (`verifyBlobIntegrity` delegates to the verifier, preserving the throw-on-mismatch F1 behaviour)

## Implementation notes
- New signature (returns a verdict, no throw):
  ```ts
  export interface IntegrityResult {
    ok: boolean;
    actualSha256: string;
    bytesHashed: bigint;
  }
  @Injectable()
  export class IntegrityVerifier {
    constructor(private readonly blobs: BlobStore, private readonly sseKey: SseKeyService) {}
    async recompute(
      bucket: string, key: string,
      opts?: { encryption?: { iv: string } },
    ): Promise<IntegrityResult>;
    async verify(
      bucket: string, key: string, expectedSha256: string,
      opts?: { encryption?: { iv: string } },
    ): Promise<IntegrityResult>; // ok = actualSha256 === expectedSha256
  }
  ```
- Move the streaming hash verbatim from `ObjectService.verifyBlobIntegrity` (lines ~773–790):
  `blobs.getBlob` → optional `createSseDecipher(this.sseKey.key(), Buffer.from(iv,'base64'))`
  → `createHash('sha256')` fed by `'data'`, resolving on `'end'`, rejecting on either
  stream's `'error'`. Do NOT change the digest domain: it stays over PLAINTEXT so the same
  hash validates single-part and multipart objects.
- `ObjectService.verifyBlobIntegrity` becomes a thin wrapper: call `verifier.verify(...)`,
  and on `!ok` keep the exact current behaviour — log the `on-disk != stored` message and
  throw `InternalError()` (F1's contract: corruption is a 500, never served bytes). ENOENT
  still maps to `NoSuchKeyError` at the call site.
- Edge cases: ENOENT must be distinguishable from a mismatch (the scrubber treats a missing
  blob as `unchecked`/error, not `corrupt`). Surface it by letting `getBlob`'s ENOENT
  propagate so callers branch on `err.code === 'ENOENT'`.
- Security/DoS: the verifier reads at `getBlob`'s 256 KB highWaterMark and streams (never
  buffers a whole object); it takes no size cap of its own — the per-tick byte budget in
  TASK-3642 bounds total work. It logs no key contents at info level.

## Acceptance criteria
- [ ] `IntegrityVerifier` is provided+exported by `StorageModule` and injectable elsewhere.
- [ ] `nx test nestjs --testPathPattern=integrity-verifier` passes for ok/corrupt/ENOENT/SSE cases.
- [ ] Existing `object.service` F1 tests still pass unchanged (behaviour preserved).

## Test obligations
- Unit: covered by [TEST-1204] (verifier ok/corrupt/SSE/ENOENT cases)
- E2E: N/A — internal seam
- Conformance: N/A

## Dependencies
- Blocked by: [STORY-0208], [STORY-0122] (SSE decipher), the existing F1 gate
