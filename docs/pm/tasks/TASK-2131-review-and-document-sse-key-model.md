---
id: TASK-2131
title: Review and document the SSE key model and its rotation roadmap
story: STORY-0703
status: ready
type: docs
size: S
---

## Description

Remediate audit finding [10] (CWE-522 Insufficiently Protected Credentials, low,
verdict PLAUSIBLE). A single instance-wide 32-byte master key encrypts every object
of every tenant (`SseKeyService.key()`, `sse-key.service.ts:57`, consumed at
`object-writer.service.ts:125,252` and `object.service.ts:282,451,496`). There is no
per-bucket/tenant/object key derivation, no key-id recorded per object (persisted
encryption state is only `{ algorithm: 'AES256', iv }`), so **rotation is impossible
without re-encrypting everything**, and decryption is gated purely on the mutable DB
field `obj.encryption` with no cryptographic binding to the on-disk bytes. The audit
confirmed the code facts but down-scoped impact: both attack legs require
pre-existing privileged access (read of `sse.key`/`OPENBUCKET_SSE_KEY`, or DB write)
that already defeats the at-rest threat model, and the "flag-flip downgrade" serves
ciphertext gibberish that the existing `contentSha256` gate catches. This is
therefore a **hardening/roadmap item, not an urgent fix**. This Task documents the
key model, its threat-model boundary, and the operational key-handling guidance, and
records the key-id / HKDF-derivation / AEAD work as an explicit decision.

## Files to create / modify

- `docs/pm/S11-DECISIONS.md` — modify. Add a decision entry: v1 ships a single
  backend-managed SSE-S3 key with no per-object/per-tenant derivation and no
  key-id/rotation (the SSE-KMS model is out of scope); record the audit's rationale
  and the roadmap toward key-id + HKDF derivation + AEAD binding.
- `libs/nestjs/README.md` — modify. Document the SSE key model on the operator-facing
  surface: single key, back it up (loss makes every encrypted object unreadable),
  deliver `OPENBUCKET_SSE_KEY` via a secrets manager/file rather than an inline env
  var, and state there is no in-place rotation in v1.
- `libs/nestjs/src/lib/storage/sse-key.service.ts` — modify (comment only). Extend
  the class doc comment (`:9-14`) to cross-reference the S11 decision and the
  documented threat-model boundary; no behavioural change.

## Implementation notes

- Ground the documentation in the audit's verified facts, not speculation:
  - One instance-wide 32-byte key (`sse-key.service.ts:18,57`), used verbatim for
    every object with no KDF (`object-writer.service.ts:125,252`;
    `object.service.ts:282,451,496`).
  - Persisted encryption state is only `{ algorithm, iv }` with **no key-id**, so
    rotation requires bulk re-encryption.
  - The cipher is non-AEAD `aes-256-ctr` (`sse-cipher.ts:15`); decryption is gated on
    the truthiness of the mutable DB field `obj.encryption`
    (`object.service.ts:281,448`).
- State the boundary explicitly: the single-key design is the documented, intended
  SSE-S3 model (per [STORY-0122]); per-object/per-tenant keys are the SSE-KMS model
  and out of scope for v1. A DB-flag "downgrade" does **not** disclose plaintext (the
  on-disk bytes are ciphertext) and is caught on the normal read path by
  `verifyBlobIntegrity`, which SHA-256s the un-decrypted bytes against the stored
  plaintext `contentSha256` and throws before any byte is served — call out the two
  residual gaps (legacy objects lacking `contentSha256`, and ranges above
  `RANGE_VERIFY_MAX_BYTES`) as known limitations.
- Capture, as roadmap (not to be built in this Task): (1) add a key-id/version field
  to `ObjectEncryptionState` and support multiple active keys so rotation needs no
  bulk re-encryption; (2) derive a per-object/per-bucket data key via
  `HKDF(masterKey, salt)` instead of the raw master key; (3) optionally move to
  AES-256-GCM with the object/bucket id in the AAD, or extend the `contentSha256`
  gate to cover legacy/large-range reads.
- CWE: **CWE-522 Insufficiently Protected Credentials**. Severity stays low/info; the
  deliverable here is honest documentation + a recorded decision, not new crypto.

## Acceptance criteria

- [ ] `docs/pm/S11-DECISIONS.md` contains a dated decision entry describing the v1
      single-SSE-key model, its threat-model boundary, and the key-id/rotation/AEAD
      roadmap, referencing audit finding [10].
- [ ] `libs/nestjs/README.md` documents: single backend-managed key, back-up
      requirement, secrets-manager/file delivery of `OPENBUCKET_SSE_KEY`, and the
      absence of in-place rotation in v1.
- [ ] `sse-key.service.ts` class doc cross-references the S11 decision (no runtime
      behaviour change; `nx test nestjs --testPathPattern=sse-key` still passes).

## Test obligations

- Unit: covered by [TEST-0703] (documentation-presence assertions — the decision
  entry and README section exist and name the key-id/rotation limitation).
- E2E: N/A — documentation/decision Task with no runtime surface.
- Conformance: N/A.

## Dependencies

- Blocked by: [STORY-0700], [TASK-2100] — P0 admin-auth bypass ships first.
- Related: [TASK-2130] (the copy decrypt fix in the same Story).

## References

- White-box security audit, 2026-07-04 — finding [10] (CWE-522, low, PLAUSIBLE),
  including the fix note: "Treat as a hardening/roadmap item, not an urgent fix …
  Add a key-id/version field … Derive a per-object (or per-bucket) data key via
  HKDF … Document/enforce operational protection of the key material."
- `libs/nestjs/src/lib/storage/sse-key.service.ts:9-14,18,57`,
  `libs/nestjs/src/lib/storage/sse-cipher.ts:15`,
  `libs/nestjs/src/lib/domain/objects/object.service.ts:281,448`.
- Prior SSE design: [STORY-0122] SSE encryption at rest; `docs/pm/S11-DECISIONS.md`.
