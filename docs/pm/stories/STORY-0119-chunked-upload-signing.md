---
id: STORY-0119
title: Chunked-upload signing (STREAMING-AWS4-HMAC-SHA256-PAYLOAD)
epic: EPIC-02
status: done
size: L
risk: high
---

## User story
As an operator using MinIO's `mc` client (or any SDK that defaults to streaming
chunked uploads), I want OpenBucket to accept
`x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` PUT/UploadPart bodies,
so that the full conformance matrix — including `mc` — passes and clients don't
have to be specially configured to use `UNSIGNED-PAYLOAD`.

## Background — why this exists
This Story resolves the first `docs/ARCHITECTURE.md` §11 open question
("Chunked-upload signing — implement `STREAMING-AWS4-HMAC-SHA256-PAYLOAD`, or
reject and require unsigned-payload-with-trailer?"). v1 deliberately **rejects**
it (`sigv4.guard.ts:45`, `put-object.interceptor.ts:105`). The forcing function:
the first real run of the conformance suite (2026-06-24, in WSL) showed
**aws-cli / s3cmd / AWS-SDK pass, but `mc` fails** — modern `mc`
(RELEASE.2025-08-13) sends `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` for `mc cp` and
has no flag to fall back to `UNSIGNED-PAYLOAD`. So STORY-0504's full-matrix green
is blocked on this. The `mc` conformance row is currently skipped with a pointer
to this Story (`apps/conformance/src/cli-matrix/mc.conformance.ts`).

## Description
Accept the AWS "Signature V4 — Transferring payload in multiple chunks
(chunked upload)" body framing for header-signed PUT/UploadPart, verify the
per-chunk signature chain, strip the framing, and stream the decoded payload to
the existing hash/size verifier and the BlobStore.

### Wire format (Content-Encoding: aws-chunked)
Each chunk is:
```
<hex-chunk-size>;chunk-signature=<64-hex>\r\n
<chunk-data>\r\n
```
repeated, terminated by a zero-length final chunk:
```
0;chunk-signature=<64-hex>\r\n
\r\n
```
- `Content-Length` is the **encoded** length; `x-amz-decoded-content-length`
  carries the true object size (use it for the size cap + Content-Length the
  handler reports).
- The optional trailer variant (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER`
  with `x-amz-trailer`, e.g. a streaming CRC32C) is a follow-up; this Story
  targets the non-trailer form `mc` uses. Reject the trailer sentinel with the
  same clear message until that follow-up lands.

### Chunk-signature chain
- **Seed signature** = the `Signature=` from the `Authorization` header, computed
  over the canonical request whose payload hash is the literal
  `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` (the verifier already uses the
  `x-amz-content-sha256` value as the canonical payload hash, so seed
  verification works once the guard stops rejecting the sentinel).
- For each chunk, string-to-sign:
  ```
  AWS4-HMAC-SHA256-PAYLOAD\n
  <x-amz-date>\n
  <credentialScope>\n
  <previous-signature>\n
  <SHA256("") hex>\n
  <SHA256(chunk-data) hex>
  ```
  `chunk-signature = HMAC-SHA256(kSigning, string-to-sign)` (hex). `kSigning` is
  the same derived AWS4 signing key used for the seed. `previous-signature`
  starts as the seed signature, then becomes each chunk's signature in turn. The
  final zero-length chunk signs `SHA256("")`.

### Integration points (where the code changes)
1. `sigv4.verifier.ts` — expose the derived `kSigning` signing key and the
   computed seed signature (today they're internal to `signatureForHeaderRequest`).
2. `sigv4.guard.ts:43-52` — when `x-amz-content-sha256 === STREAMING_SHA`:
   verify the seed signature (don't reject), and stash
   `{ signingKey, seedSignature, amzDate, credentialScope }` on `req.openbucket`
   for the decoder. Keep rejecting the `-TRAILER` sentinel for now.
3. New `ChunkedDecoderTransform` (Node `Transform`) — buffers across TCP reads,
   parses the framing, verifies each chunk-signature against the rolling chain
   (constant-time compare), emits **decoded** bytes, errors with
   `SignatureDoesNotMatchError` on a bad chunk sig and `IncompleteBodyError` on a
   truncated/short stream vs `x-amz-decoded-content-length`.
4. `put-object.interceptor.ts:105` — replace the hard reject: for the streaming
   branch, pipe `req → ChunkedDecoderTransform → existing md5/sha256 verifier`.
   Set `verifySha=false` (the header isn't a body hash) but still compute
   md5/sha256 for the ETag; enforce the size cap against decoded bytes; keep the
   256 KB highWaterMark backpressure.

### Invariants / edge cases
- Backpressure: the decoder must honor downstream pause (don't buffer the whole
  body); cap the inter-chunk header scan buffer.
- Size cap applies to decoded length; reject if decoded total ≠
  `x-amz-decoded-content-length`.
- Applies to both `PutObject` and `UploadPart` (same interceptor path).
- Presigned and `UNSIGNED-PAYLOAD`/hex-digest paths are unchanged.

## Acceptance criteria
- [ ] A header-signed PUT with `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`,
      `Content-Encoding: aws-chunked`, valid per-chunk signatures, and a correct
      `x-amz-decoded-content-length` stores the decoded object; ETag = `MD5(decoded)`.
- [ ] A chunk with a tampered `chunk-signature` is rejected `403 SignatureDoesNotMatch`.
- [ ] A truncated stream (bytes < decoded-content-length) is rejected `IncompleteBody`.
- [ ] `UploadPart` accepts the same framing; multipart ETag is unaffected.
- [ ] The `-TRAILER` sentinel still returns the clear "not supported" `InvalidArgument`.
- [ ] `mc cp` / `mc cat` round-trip byte-equal in the conformance suite (un-skip
      the `mc` row); aws-cli / s3cmd / SDK rows stay green. STORY-0504 full matrix green.

## Tasks
_Task IDs allocated at refinement (EPIC-02 range, next free `TASK-0364`). Breakdown:_
- Expose `kSigning` + seed signature from `Sigv4Verifier`.
- Accept STREAMING seed in `SigV4Guard`; stash chunk-signing context; keep `-TRAILER` rejected.
- Implement `ChunkedDecoderTransform` (framing parse + rolling chunk-sig verify).
- Wire decoder into `PutObjectInterceptor` (decoded-length size cap, md5/sha256 for ETag).
- Un-skip and verify the `mc` conformance row; add unit vectors (AWS doc example).

## Test plan
Implemented directly (impl-first). Tests landed:
- Unit: chunk-signature chain against AWS's published example vectors; decoder
  framing (multi-chunk, zero-final, tampered sig, truncated).
- e2e: a hand-crafted chunked PUT (Node test client) round-trips.
- Conformance: the `mc` row (currently skipped) goes green.

## Dependencies
- Blocked by: [STORY-0103] (SigV4 core — done), [STORY-0301] (PutObjectInterceptor — done).
- Blocks: [STORY-0504] full conformance-matrix green (the `mc` row).

## References
- `docs/ARCHITECTURE.md` §11 (open question #1 — chunked-upload signing).
- AWS: "Signature Calculations for the Authorization Header: Transferring Payload
  in Multiple Chunks (Chunked Upload)".
- Current rejection: `apps/openbucket-backend/src/s3/sigv4/sigv4.guard.ts:45`,
  `apps/openbucket-backend/src/s3/object/put-object.interceptor.ts:105`.
- Surfaced by: `apps/conformance/src/cli-matrix/mc.conformance.ts` (mc row).

## Verification (2026-06-24)
Implemented and verified end-to-end:
- **Code:** `chunk-signing.ts` (per-chunk signature chain), `Sigv4Verifier.deriveSigningKey` (exposed), `SigV4Guard` (accepts the STREAMING seed + stashes the signing context; rejects only the `-TRAILER` variants), `ChunkedDecoder` (framing parser + rolling chunk-sig verify), and `PutObjectInterceptor` wiring.
- **Unit:** `chunked-decoder.spec.ts` — 9 tests incl. the **AWS published reference vectors** (seed→chunk₁→chunk₂→final signatures match byte-for-byte, validating the string-to-sign format independently), multi-chunk round-trip, 1-byte-write reassembly, tampered-sig → SignatureDoesNotMatch, truncated/length-mismatch → IncompleteBody. Plus guard `-TRAILER` rejection + interceptor positive/negative streaming cases. Full backend suite: **57 suites, 453 pass, 0 fail**.
- **Conformance:** the previously-failing **`mc` row now passes** against a freshly-built image (real `mc` RELEASE.2025-08-13, chunked upload); full matrix **4/4 green** (aws-cli, s3cmd, SDK, mc). Unblocks [STORY-0504].
- **Deferred:** the trailing-checksum variants (`STREAMING-*-TRAILER`) remain rejected with a clear message (follow-up).
