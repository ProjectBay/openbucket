---
id: TASK-2130
title: Decrypt the source blob before re-encrypting on server-side CopyObject and UploadPartCopy
story: STORY-0703
status: ready
type: implementation
size: M
---

## Description

Remediate audit finding [4] (CWE-325 Missing Cryptographic Step, medium).
`copyObject` reads the source via `this.blobs.getBlob(srcBucket, srcKey)`
(`object.service.ts:334`), which returns the **raw on-disk stream with no
decryption** (`blob-store.ts:157-175`), then passes it straight to
`this.writer.put({ … body: blob.stream … })` (`object.service.ts:335-341`). The
writer treats that body as plaintext: `putBlob` taps the **input** for MD5/SHA-256
before the optional cipher (`blob-store.ts:88-94`), and re-encrypts only if the
**destination** bucket has default encryption (`object-writer.service.ts:120-128`).
For an SSE-encrypted source this stores ciphertext hashed as if it were plaintext.
The identical missing-decrypt gap exists in `uploadPartCopy`
(`multipart.service.ts:341`). This Task decrypts the source before handing bytes to
the writer/`putPart`, mirroring the existing openObjectStream read path.

## Files to create / modify

- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify. In `copyObject`
  (`:311-348`), after `getBlob` (`:334`), when `src.encryption` is set, wrap
  `blob.stream` with `createSseDecipher(...)` and pass the resulting **plaintext**
  stream to `this.writer.put` instead of the raw `blob.stream`.
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` — modify. In
  `uploadPartCopy` (`:309-350`), after `getBlob` (`:341`), apply the same
  source-decrypt before `this.blobs.putPart(...)`, honouring the
  `x-amz-copy-source-range` against **plaintext** offsets (use a range decipher
  positioned at the plaintext start, as the Range GET path already does).
- `libs/nestjs/src/lib/domain/objects/object.service.spec.ts` /
  `libs/nestjs/src/lib/domain/multipart/multipart.service.spec.ts` — modify/new.
  Add the encrypted-source copy round-trip assertions for [TEST-0703].

## Implementation notes

- Mirror the proven decrypt pattern already used by `openObjectStream`
  (`object.service.ts:281-287`):
  ```ts
  let stream: Readable = blob.stream;
  if (obj.encryption) {
    const sk = this.sseKey.key();
    const iv = Buffer.from(obj.encryption.iv, 'base64');
    stream = blob.stream.pipe(createSseDecipher(sk, iv));
    stream.on('error', () => blob.stream.destroy()); // tear down the source fd
  }
  ```
  In `copyObject`, apply the equivalent guarded on `src.encryption` and pass the
  wrapped plaintext `stream` (not `blob.stream`) into `this.writer.put({ body: … })`.
- Once the writer receives real plaintext, `putBlob` computes the correct plaintext
  MD5/SHA-256 (`blob-store.ts:88-94`) and re-encrypts per the **destination**
  bucket policy (`object-writer.service.ts:120-128`). Result: the returned
  `CopyObjectResult` ETag equals the source ETag, the stored `contentSha256` is over
  true plaintext, and reads decrypt correctly.
- For `uploadPartCopy`, `getBlob(srcBucket, srcKey, range)` currently seeks into
  **ciphertext** bytes; for an encrypted source the copy-source-range must be
  interpreted against plaintext. Use `createRangeDecipher` /
  `counterForOffset(iv, start)` (both already in `sse-cipher.ts:36,90`) so the CTR
  keystream lines up at the plaintext offset, or read the aligned ciphertext slice
  and drop the intra-block prefix with `rangeSkip` — consistent with how the Range
  GET path handles it.
- Attach an `error` handler to the decipher that `destroy()`s the underlying source
  fd, exactly as openObjectStream does, so a decrypt error never leaks a file handle.
- Do not touch the destination-encryption logic — it is correct; the only defect is
  that the writer is fed ciphertext instead of plaintext.
- CWE: **CWE-325 Missing Cryptographic Step**. The audit's own fix note prescribes
  precisely this decrypt-then-hand-to-writer approach.

## Acceptance criteria

- [ ] `nx test nestjs --testPathPattern=object.service.spec` passes with a new case
      copying an encrypted source to an **unencrypted** destination and asserting the
      GET body equals the original plaintext.
- [ ] The same spec asserts a copy of an encrypted source to an **encrypted**
      destination reads back as the original plaintext (not double-encrypted).
- [ ] The returned `CopyObjectResult` ETag equals the source object's ETag for an
      encrypted-source copy.
- [ ] `nx test nestjs --testPathPattern=multipart.service.spec` passes with an
      `UploadPartCopy` from an encrypted source (full object and a byte range) whose
      completed object reads back as the original plaintext.

## Test obligations

- Unit: covered by [TEST-0703] (copyObject and uploadPartCopy decrypt/re-encrypt
  round-trip, ETag equality).
- E2E: covered by [TEST-0703] (aws-cli/SDK `cp` of an encrypted object across
  buckets, asserting body + ETag).
- Conformance: N/A — behavioural correctness verified by the unit/e2e cases above.

## Dependencies

- Blocked by: [STORY-0700], [TASK-2100] — the critical unauthenticated admin-API
  bypass (CWE-178) is the P0 that must land/ship first.

## References

- White-box security audit, 2026-07-04 — finding [4] (CWE-325, medium), including
  the fix note: "after getBlob, if `src.encryption` is set, wrap the stream with
  `createSseDecipher(this.sseKey.key(), Buffer.from(src.encryption.iv,'base64'))` …
  Apply the identical decryption to `uploadPartCopy` (`multipart.service.ts:341`)."
- `libs/nestjs/src/lib/domain/objects/object.service.ts:281-287` (decrypt pattern),
  `:311-348` (copyObject), `libs/nestjs/src/lib/storage/blob-store.ts:88-94,157-175`,
  `libs/nestjs/src/lib/storage/object-writer.service.ts:120-128`,
  `libs/nestjs/src/lib/storage/sse-cipher.ts:27,36,90`,
  `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:309-350`.
