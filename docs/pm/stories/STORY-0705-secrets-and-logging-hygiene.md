---
id: STORY-0705
title: Secrets & logging hygiene
epic: EPIC-08
status: ready
size: S
risk: medium
---

## User story
As an operator running `@openbucket/nestjs` in a hostile-internet deployment, I
want request logs to be free of replayable SigV4 credentials and the boot-time
config gate to reject trivially-guessable secrets, so that neither a log reader
nor a careless scaffolding default hands an attacker a working credential.

## Description
Closes the two `secrets-config` findings from the 2026-07-04 white-box audit.
Finding [7] (CWE-532, medium): the Pino request serializer in
`open-bucket-core.module.ts` logs `req.url` verbatim, and the `redact` block only
covers headers — so every presigned request writes its `X-Amz-Signature` and
`X-Amz-Credential` (access-key-id) query params to stdout at `info`, where any
log reader can replay them within the presign window (up to 7 days). Finding [18]
(CWE-521, info): `JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY` are validated with a
bare `.min(32)` length check in both `env.schema.ts` and the mirrored library
guard `open-bucket-options.ts`, so a 32-char placeholder like
`'a'.repeat(32)` boots cleanly and can be dictionary-forged into an admin JWT.
This Story sanitizes SigV4 query auth out of the logged URL and adds a
low-false-positive placeholder/entropy guard to the secret-validation gate,
keeping the existing refuse-to-boot semantics.

## Acceptance criteria
- [ ] A completed presigned request (`?X-Amz-Signature=...&X-Amz-Credential=...`)
      produces a log line whose `url` contains neither the signature value nor the
      credential value (both stripped or `[redacted]`).
- [ ] Non-presigned request URLs (path + benign query) are still logged intact for
      debuggability.
- [ ] `X-Amz-Security-Token`, when present in the query, is also removed from the
      logged URL.
- [ ] Booting with `JWT_SECRET='a'.repeat(32)` (or another all-identical /
      known-placeholder value) is rejected with the existing
      `Refusing to boot: invalid environment.` message and a per-field reason.
- [ ] A CSPRNG-generated secret (e.g. `openssl rand -base64 48`) still boots.
- [ ] The same secret-strength guard is applied in the library path
      (`open-bucket-options.ts`) so the standalone and embedded modes stay in sync.

## Tasks
- [TASK-2150] Redact SigV4 signature and access-key id in request logs
- [TASK-2151] Strengthen secret-entropy validation

## Test plan
- [TEST-0705] Log redaction and secret entropy

## Dependencies
- Blocks: none.
- Blocked by: none technically — but [STORY-0700] `TASK-2100` (the P0 critical
  unauthenticated admin-API bypass, CWE-178) is the critical fix that should land
  first as a patch release; this Story is lower-priority hardening and should
  merge behind it.

## References
- White-box security audit, 2026-07-04 — finding [7] (CWE-532, medium,
  secrets-config) and finding [18] (CWE-521, info, secrets-config).
- `libs/nestjs/src/lib/open-bucket-core.module.ts:78-85` — Pino `req` serializer
  logging `req.url`; `:68-77` — header-only `redact` block.
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts:191` — existing `stripParam` helper
  to generalize; `:147,150,174` — presign query params carrying credentials.
- `libs/nestjs/src/lib/common/config/env.schema.ts:19,36-38` — `.min(32)`-only
  validation of `JWT_SECRET` / `ROOT_SECRET_ACCESS_KEY`.
- `libs/nestjs/src/lib/open-bucket-options.ts:172-190` —
  `validateSecurityCriticalOptions` mirror.
