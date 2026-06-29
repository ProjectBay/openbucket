---
id: STORY-0118
title: ListObjectsV2 pagination with HMAC-sealed continuation token
epic: EPIC-02
status: done
size: M
risk: medium
---

## User story
As an S3 client, I want `GET /:bucket?list-type=2` with `?continuation-token=…` to return a tamper-proof token for the next page, so that pagination round-trips faithfully and a forged token cannot be used to read across buckets.

## Description
Realize §2.10 of the white paper. Implement `ContinuationToken` with a per-process HMAC secret (`crypto.randomBytes(32)` at `OnModuleInit`) and `encode/decode` using `base64url(JSON.stringify(cursor) || hmacTrunc12)`. Implement `ObjectService.listObjectsV2` (handler-side) that decodes the inbound token (binding it to the requesting bucket), queries `objects.repo.listObjects` with `limit = maxKeys + 1` to detect truncation, and emits the next token only when truncated. The SQL itself belongs to EPIC-03; this Story owns the wire surface and the token machinery.

## Acceptance criteria
- [ ] `ContinuationToken.encode(cursor)` returns a base64url string of `payload || HMAC-SHA256(secret, payload)[0..12]`.
- [ ] `ContinuationToken.decode(token, bucket)` uses `crypto.timingSafeEqual` and throws `InvalidArgumentError` on any mismatch / wrong bucket / wrong `v`.
- [ ] `MaxKeys` default 1000, cap 1000.
- [ ] `IsTruncated`, `KeyCount`, `NextContinuationToken` (only when truncated), `Prefix`, `Name` set on the result.
- [ ] `ListObjectsV1` returns `Marker`/`NextMarker` (last key) instead of an HMAC-sealed token.

## Tasks
- [TASK-0362] Implement ContinuationToken (HMAC-sealed token)
- [TASK-0363] Implement ListObjectsV2 handler with cursor decode/encode

## Test plan
- [TEST-0134] ContinuationToken unit
- [TEST-0135] ListObjectsV2 pagination e2e
- [TEST-0136] ListObjectsV2 conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0102], [STORY-0103], [STORY-0105], [STORY-0108], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.10 (lines 2689–2814)
- Interfaces consumed: `BucketRepository.listObjects` (EPIC-03), `InvalidArgumentError` (STORY-0105)
- Interfaces produced: `ContinuationToken`, `ListCursor`
