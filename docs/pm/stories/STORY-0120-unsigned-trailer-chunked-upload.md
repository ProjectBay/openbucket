---
id: STORY-0120
title: Unsigned trailer chunked upload (STREAMING-UNSIGNED-PAYLOAD-TRAILER)
epic: EPIC-02
status: done
size: M
risk: medium
---

## User story
As a developer streaming uploads through the **AWS SDK** with data-integrity
checksums (a non-seekable body + `ChecksumAlgorithm`), I want OpenBucket to
accept `x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER`, so that the
SDK's streaming-checksum upload (unsigned `aws-chunked` body + a trailing CRC-32)
works instead of being rejected.

## Background
Follow-up to [STORY-0119] (signed chunked upload). OpenBucket previously rejected
all `-TRAILER` sentinels.

**Empirically (2026-06-24, verified against the rebuilt image):** an AWS SDK
`PutObject` with a streaming (non-seekable) `Body` + `ChecksumAlgorithm: CRC32`
sends `STREAMING-UNSIGNED-PAYLOAD-TRAILER` with `x-amz-trailer: x-amz-checksum-crc32`.
Note the earlier assumption that **aws-cli v2** triggers this was wrong — aws-cli
v2 buffers/seeks and computes the checksum upfront, sending a **hex** sha256 +
the checksum as a regular header (no trailer), so it works without this Story.
The trailer form is a *streaming-SDK* protocol-completeness gap, not an aws-cli
gap. The conformance CLI matrix wouldn't have caught it either.

## Description
- **Wire format:** `<hex-size>\r\n<data>\r\n` … `0\r\n<trailing-header>:<value>\r\n\r\n`.
  No per-chunk signature (payload is unsigned); `x-amz-decoded-content-length`
  gives the object size; `content-encoding: aws-chunked`; `x-amz-trailer` names
  the trailing header.
- **SigV4Guard:** accept `STREAMING-UNSIGNED-PAYLOAD-TRAILER` — the seed is
  verified like any header-signed request (canonical payload hash = the
  sentinel); no chunk-signing context needed. Keep rejecting the *signed* trailer
  form (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER`), which also signs the
  trailer (separate follow-up).
- **ChunkedDecoder:** generalized with `signed` + `trailer` flags. Unsigned mode
  parses bare `<hex>` chunk headers (no signature verify) and, after the final
  chunk, parses the trailer section, validating `x-amz-checksum-crc32` against a
  running `zlib.crc32` over decoded bytes (`BadDigest` on mismatch). Other
  checksum algorithms are accepted without validation for now (parity with the
  unsigned-payload posture).
- **PutObjectInterceptor:** routes `STREAMING-UNSIGNED-PAYLOAD-TRAILER` to an
  unsigned+trailer decoder (no ctx), `verifySha=false`, size cap on the decoded
  length.

## Acceptance criteria
- [x] A PUT with `STREAMING-UNSIGNED-PAYLOAD-TRAILER` + valid framing + correct
      `x-amz-decoded-content-length` stores the decoded object.
- [x] A wrong `x-amz-checksum-crc32` trailer is rejected `400 BadDigest`.
- [x] The *signed* trailer sentinel still returns the clear "not supported"
      `InvalidArgument`.
- [x] An AWS SDK streaming `PutObject` (non-seekable `Body` + `ChecksumAlgorithm:
      CRC32`) round-trips byte-equal against the built image.

## Tasks
Implemented directly (impl-first). Code: generalized `chunked-decoder.ts`
(`signed`/`trailer` flags + CRC-32 trailer validation), `sigv4.guard.ts`
(accept unsigned trailer), `put-object.interceptor.ts` (route the sentinel).

## Test plan
- Unit: `chunked-decoder.spec.ts` "unsigned + trailer" block — round-trip
  (single/multi-chunk, no-trailer, 1-byte writes), wrong-CRC → BadDigest.
- Conformance: an aws-cli **v2** row (default checksums) round-trips.

## Dependencies
- Blocked by: [STORY-0119].
- Blocks: _none directly; protocol completeness for AWS SDK streaming-checksum uploads._

## References
- `docs/ARCHITECTURE.md` §11 (chunked-upload signing).
- AWS: "Unsigned payload option" / trailing checksums (aws-chunked trailer).

## Verification (2026-06-24)
- **Unit:** `chunked-decoder.spec.ts` "unsigned + trailer" block — round-trip
  (single/multi-chunk, no-checksum, 1-byte writes) + wrong-CRC → `BadDigest`.
  Full backend suite green (a 1-suite timeout under concurrent CPU load during
  the run was a confirmed flake — passes in isolation).
- **End-to-end (real client):** rebuilt `openbucket:local`; an `@aws-sdk/client-s3`
  `PutObject` with a `Readable` body + `ChecksumAlgorithm: CRC32` sent
  `x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER` +
  `x-amz-trailer: x-amz-checksum-crc32` (confirmed via a finalizeRequest
  middleware logging the outgoing header); the PUT was accepted and the object
  read back **byte-equal**. aws-cli v1 (hex) and aws-cli v2 (hex + header
  checksum) were empirically observed *not* to use the trailer, so the existing
  conformance rows are unaffected.
