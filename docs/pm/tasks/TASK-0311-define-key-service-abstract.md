---
id: TASK-0311
title: Define KeyService abstract and AccessKey interface
story: STORY-0103
status: done
type: implementation
size: XS
---

## Description
Define the `KeyService` abstract class and `AccessKey` interface that the SigV4 layer depends on. The concrete `SqliteKeyService` is owned by EPIC-03; the S3 module imports only the abstract token.

## Files to create / modify
- `apps/backend/src/s3/sigv4/key.service.ts` — new

## Implementation notes
- Verbatim from §2.4.2 (lines 1594–1617):
  ```ts
  export interface AccessKey {
    accessKeyId: string;
    secretAccessKey: string;
    disabled: boolean;
  }

  export abstract class KeyService {
    /**
     * Resolve an access key id to its secret.
     *
     * Contract:
     *  - Returns null if the access key id is unknown OR is disabled.
     *  - MUST be constant-time across all known/unknown branches at the
     *    *caller's* level — i.e., it is acceptable for this method to return
     *    quickly with null; the SigV4Guard wraps the comparison in
     *    timingSafeEqual to prevent timing leakage of the secret itself.
     *  - The implementation MAY cache results in memory for up to 60 s.
     *  - Implementation belongs to the persistence agent (see §4).
     */
    abstract getSecret(accessKeyId: string): Promise<AccessKey | null>;
  }
  ```

## Acceptance criteria
- [ ] `KeyService` is exported as abstract; nothing in this Epic instantiates it.
- [ ] `AccessKey.disabled` field present per §2.4.2.

## Test obligations
- Unit: covered by [TEST-0104]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.4.2 (lines 1591–1620)
