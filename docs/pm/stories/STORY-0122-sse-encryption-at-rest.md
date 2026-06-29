---
id: STORY-0122
title: SSE-S3 encryption at rest (real AES-256)
epic: EPIC-03
status: done
size: L
risk: high
---

## User story
As an operator who enables bucket default encryption, I want object payloads to
be actually **encrypted on disk**, so that "SSE-S3 supported" is a true statement
rather than stored-but-ignored configuration.

## Background
`docs/pm/S11-DECISIONS.md` #5 found that the SSE config is accepted + round-tripped
but blobs are stored **plaintext** (no cipher in the storage path). As of
2026-06-25 the misleading wording was corrected (config-only is now documented;
see `ARCHITECTURE.md` §10) — this Story is the real implementation, **deferred and
gated on a decision** because it is a one-way door for on-disk data.

## Decision required before building
- **Key strategy** (the §11 sub-question): single backend-managed key vs
  per-bucket key vs KMS-style envelope. Recommend a **single backend key** for v1
  (`SSE-S3` semantics), persisted in the data dir / DB, with documented backup of
  that key (lose it → lose all encrypted data).
- **Cipher + Range:** `AES-256-CTR` (seekable → supports `Range` GET by counter
  offset) vs `AES-256-GCM` (per-object integrity tag, but `Range` is hard). AWS
  SSE-S3 supports Range, so CTR is the pragmatic pick; object integrity is already
  covered by the stored ETag/SHA-256.

## Description (when greenlit)
- Encrypt on write in the blob path (`ObjectWriterService` → `BlobStore.putBlob`):
  random IV per object, AES-256-CTR, store IV + algorithm per object.
- Decrypt on read (`getObject` stream), including `Range` (seek the CTR counter).
- Encrypt only when the bucket (or object override) has SSE enabled; pre-existing
  plaintext objects stay readable (store the algorithm per object, default none).
- Key lifecycle: generate-on-first-boot + persist; document backup/rotation.

## Acceptance criteria
- [x] An object PUT to an SSE-enabled bucket is stored ciphertext on disk (the raw
      blob file does not contain the plaintext).
- [x] GET returns the decrypted bytes, byte-equal; `Range` returns exact bytes.
- [x] Objects written before SSE-enable stay readable.
- [x] Losing/rotating the key is documented.

## Dependencies
- Blocked by: a key-strategy decision (see above) + product sign-off.

## References
- `docs/pm/S11-DECISIONS.md` #5; `docs/ARCHITECTURE.md` §10.

## Verification (2026-06-25)
Implemented per the recommendation: single backend key + **AES-256-CTR**.
- **Unit:** `sse-cipher.spec.ts` (5 — round-trip, decryptRange across aligned/
  unaligned/single-byte/whole-object, counter-carry, wrong-key) + a writer
  integration test (SSE bucket → on-disk bytes are ciphertext that decrypt to
  plaintext; ETag/size over plaintext; CTR length-preserving). Full backend suite
  green; lint clean.
- **End-to-end (real client, rebuilt image):** `@aws-sdk/client-s3` enabled bucket
  SSE, PUT a 102 KB object → **GET byte-equal**, **Range GET (offset 50000, 100B)
  exact**, the on-disk blob has **0 plaintext-marker hits** (real ciphertext at
  rest, size-preserved), and `<DATA_DIR>/sse.key` was auto-generated (32 B).
- **Runtime gotcha fixed:** the migration had to be registered in
  `persistence.module`'s explicit `migrationsList` (webpack bundles main.js, so the
  glob finds nothing) — caught only by the e2e against the built image (commit 04e0437).
- **Scope:** the `put()` (single PutObject) path. Multipart-completed objects and
  version-specific (`?versionId`) GET decryption are follow-ups; new versions carry
  their IV so data is recoverable.
