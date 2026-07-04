---
id: TEST-0703
title: CopyObject SSE decrypt/re-encrypt round-trip and SSE key-model documentation
covers: [STORY-0703, TASK-2130, TASK-2131]
status: ready
level: unit
---

## Goal

Prove that a server-side copy (CopyObject and UploadPartCopy) of an SSE-encrypted
source decrypts before re-encrypting, so the destination reads back byte-for-byte as
the original plaintext, the returned ETag equals the source ETag, and the read-time
integrity gate reflects real plaintext rather than a forged signal over ciphertext
([TASK-2130], finding [4]). Also assert the SSE key-model documentation and decision
exist ([TASK-2131], finding [10]).

## Setup

- In-memory SQLite + a temp `DATA_DIR` per the project unit-test conventions.
- `SseKeyService` initialised with a fixed 32-byte test key.
- Fixtures: bucket `enc-a` with default encryption `AES256`; bucket `plain-b` with
  no default encryption; bucket `enc-c` with default encryption `AES256`.
- Seed a known plaintext object `enc-a/hello.txt` (distinctive multi-block body so
  CTR offsets matter) via the two-phase writer, so it is stored encrypted on disk
  with an `{ algorithm: 'AES256', iv }` encryption row. Record its plaintext ETag.

## Cases

1. **Encrypted source → unencrypted destination round-trips plaintext.**
   Given `enc-a/hello.txt` (encrypted on disk), when `copyObject` copies it to
   `plain-b/hello.txt`, then a subsequent GET of `plain-b/hello.txt` returns a body
   byte-for-byte equal to the original plaintext (not ciphertext).

2. **Copy ETag equals the source ETag.**
   Given the same copy as case 1, then the returned `CopyObjectResult.ETag` equals
   the source object's ETag (plaintext MD5), i.e. `"<src.etag>"`, not the MD5 of
   ciphertext.

3. **Encrypted source → encrypted destination is single-encrypted, not doubled.**
   Given `enc-a/hello.txt`, when `copyObject` copies it to `enc-c/hello.txt`, then a
   GET of `enc-c/hello.txt` returns the original plaintext (one decrypt on read),
   and the stored `contentSha256` equals the SHA-256 of the original plaintext.

4. **Read-time integrity gate is honest after copy.**
   Given the destination from case 1, when GET runs `verifyBlobIntegrity`, then it
   passes because the on-disk bytes decrypt to plaintext whose SHA-256 matches the
   stored digest — confirming the pre-fix "forged integrity signal over ciphertext"
   no longer occurs (a regression that reintroduces the raw-stream copy would make
   case 1's body assertion fail).

5. **UploadPartCopy from an encrypted source stages plaintext (full object).**
   Given a multipart upload on `plain-b`, when `uploadPartCopy` copies
   `enc-a/hello.txt` as part 1 and the upload is completed, then a GET of the
   completed object returns the original plaintext and the object ETag matches the
   single-part multipart ETag over plaintext.

6. **UploadPartCopy honours copy-source-range against plaintext offsets.**
   Given `enc-a/hello.txt`, when `uploadPartCopy` copies `bytes=5-20` of it as a
   part, then the staged part bytes equal the original plaintext bytes `[5..20]`
   (not ciphertext bytes at those offsets), verifying range decryption via the
   plaintext-positioned CTR counter.

7. **SSE key-model decision is documented ([TASK-2131]).**
   Then `docs/pm/S11-DECISIONS.md` contains a decision entry that describes the v1
   single instance-wide SSE key, the absence of a per-object key-id / in-place
   rotation, and references audit finding [10].

8. **Operator SSE guidance is documented ([TASK-2131]).**
   Then `libs/nestjs/README.md` states the SSE key must be backed up, `OPENBUCKET_SSE_KEY`
   should be delivered via a secrets manager/file, and there is no in-place key
   rotation in v1.

## Tooling

- Framework: jest (+ @aws-sdk/client-s3 for the e2e `cp`/`upload-part-copy` legs)
- Runner: `nx test nestjs` (unit) / `nx e2e nestjs-e2e` (SDK cp round-trip)

## Pass criteria

- [ ] Cases 1–6 pass: encrypted-source CopyObject and UploadPartCopy produce
      destinations whose GET body equals the original plaintext, and the copy ETag
      equals the source ETag.
- [ ] Cases 7–8 pass: the S11 decision entry and the `libs/nestjs/README.md` SSE
      section exist and name the single-key/no-rotation limitation.

## References

- White-box security audit, 2026-07-04 — findings [4] (CWE-325) and [10] (CWE-522).
- [STORY-0703], [TASK-2130], [TASK-2131].
- `libs/nestjs/src/lib/domain/objects/object.service.ts:281-287,311-348`,
  `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:309-350`,
  `libs/nestjs/src/lib/storage/sse-cipher.ts:27,36,90`.
