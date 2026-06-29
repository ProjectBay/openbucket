---
id: STORY-0104
title: Presigned URL verification
epic: EPIC-02
status: done
size: S
risk: medium
---

## User story
As an S3 client, I want presigned URLs to be verified against the root access key with `X-Amz-Date`/`X-Amz-Expires` bounds enforced, so that pre-signed PUT/GET operations work and expired or tampered URLs are rejected.

## Description
Realize §2.5 of the white paper. Implement `verifyPresigned` in `apps/backend/src/s3/sigv4/presigned.ts` that consumes `X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires` (1..604800 = 7 days), `X-Amz-SignedHeaders`, and `X-Amz-Signature`, strips `X-Amz-Signature` from the canonical query, and reproduces the signing chain. `SigV4Guard.canActivate` dispatches to this path when `X-Amz-Signature` query parameter is present.

## Acceptance criteria
- [ ] `X-Amz-Algorithm` other than `AWS4-HMAC-SHA256` yields `InvalidArgumentError`.
- [ ] `X-Amz-Expires` outside `[1, 7*24*60*60]` yields `InvalidArgumentError`.
- [ ] Request after `start + expires*1000` yields `AccessDeniedError('Request has expired')`.
- [ ] Request before `start - MAX_SKEW_MS` yields `RequestTimeTooSkewedError`.
- [ ] `X-Amz-Signature` is excluded from canonical query; all other `X-Amz-*` params included.
- [ ] Mismatch returns `false` (caller throws generic `SignatureDoesNotMatchError`); no leakage of whether the access-key id is known.

## Tasks
- [TASK-0316] Implement verifyPresigned

## Test plan
- [TEST-0107] Presigned verification unit
- [TEST-0108] Presigned URL e2e

## Dependencies
- Blocks: [STORY-0109]
- Blocked by: [STORY-0103]

## References
- `docs/WHITEPAPER.md` §2.5 (lines 1985–2131)
- Interfaces consumed: `KeyService`, `Sigv4Verifier`, `buildCanonicalRequest` (defined in STORY-0103); `AccessDeniedError`, `InvalidArgumentError`, `RequestTimeTooSkewedError` (defined in STORY-0105)
- Interfaces produced: `verifyPresigned`, `MAX_EXPIRES`
