---
id: STORY-0703
title: Server-side encryption correctness
epic: EPIC-08
status: ready
size: M
risk: medium
---

## User story

As an S3 client, I want a server-side copy of an SSE-encrypted object to round-trip
its plaintext correctly, so that copied objects are readable, their ETags match the
source, and the read-time integrity gate reflects real data rather than a forged
signal over ciphertext.

## Description

The July 2026 security audit confirmed two crypto-SSE findings. Finding [4]
(CWE-325, medium) is a missing cryptographic step: `copyObject` (and
`uploadPartCopy`) hand the raw on-disk stream to the writer without decrypting an
encrypted source first, so ciphertext is hashed and stored as if it were plaintext —
silently corrupting the destination while `verifyBlobIntegrity` still reports
success (a forged integrity signal), and returning a wrong ETag. Finding [10]
(CWE-522, low) is a defense-in-depth/operability limitation: a single instance-wide
SSE key with no per-object/per-tenant derivation, no key-id for rotation, and
decryption gated purely on the mutable `obj.encryption` DB flag with no
cryptographic binding to the ciphertext. This Story fixes the copy decrypt gap and
reviews/documents the key model, capturing the rotation and key-derivation work as
an explicit roadmap decision rather than an urgent code change.

## Acceptance criteria

- [ ] A server-side copy of an SSE-encrypted object to an **unencrypted** destination
      yields a destination whose GET body byte-for-byte equals the source plaintext.
- [ ] A server-side copy of an SSE-encrypted object to an **encrypted** destination
      yields a destination whose GET body byte-for-byte equals the source plaintext
      (single decrypt on read, not double-encrypted garbage).
- [ ] The `CopyObjectResult` ETag returned for a copy of an encrypted source equals
      the source object's ETag (plaintext MD5), not the MD5 of ciphertext.
- [ ] `UploadPartCopy` from an encrypted source stages plaintext, so the completed
      multipart object reads back as the original plaintext and honours
      `x-amz-copy-source-range` against plaintext offsets.
- [ ] The SSE key model (single instance-wide key, no key-id/rotation, flag-gated
      decrypt) is documented with its threat-model boundary, and the key-id /
      HKDF-derivation / AEAD roadmap is captured as a decision, not left implicit.

## Tasks

- [TASK-2130] Decrypt the source blob before re-encrypting on server-side CopyObject and UploadPartCopy
- [TASK-2131] Review and document the SSE key model; record the key-id/rotation roadmap

## Test plan

- [TEST-0703] CopyObject SSE decrypt/re-encrypt round-trip and SSE key-model documentation checks

## Dependencies

- Blocks: (a hardened 0.1.x SSE data path)
- Blocked by: [STORY-0700] — the critical unauthenticated admin-API bypass
  (CWE-178) fixed in [TASK-2100] is the P0 that must land and ship first; this
  Story's fixes are correctness/hardening and follow the P0 patch release.

## References

- White-box security audit, 2026-07-04 — finding [4] "Server-side CopyObject
  streams SSE ciphertext as plaintext (missing decrypt step)" (CWE-325, medium)
  and finding [10] "Single instance-wide SSE key … decryption gated solely on a
  mutable DB flag" (CWE-522, low).
- Interfaces consumed: `createSseDecipher(key, iv)`
  (`libs/nestjs/src/lib/storage/sse-cipher.ts:27`), `SseKeyService.key()`
  (`libs/nestjs/src/lib/storage/sse-key.service.ts:57`), the openObjectStream
  decrypt pattern (`libs/nestjs/src/lib/domain/objects/object.service.ts:281-287`).
- Interfaces produced: corrected `copyObject`
  (`libs/nestjs/src/lib/domain/objects/object.service.ts:311-348`) and
  `uploadPartCopy` (`libs/nestjs/src/lib/domain/multipart/multipart.service.ts:309-350`).
- Prior SSE design: [STORY-0122] SSE encryption at rest.
