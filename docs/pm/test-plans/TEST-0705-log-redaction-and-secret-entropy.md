---
id: TEST-0705
title: Log redaction and secret entropy
covers: [STORY-0705, TASK-2150, TASK-2151]
status: ready
level: unit
---

## Goal
Verify (a) the Pino request serializer strips SigV4 query-auth params
(`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`) from the logged
URL while preserving benign query params, and (b) the refuse-to-boot config gate
rejects weak/placeholder `JWT_SECRET` / `ROOT_SECRET_ACCESS_KEY` values in both
the standalone schema and the library `validateSecurityCriticalOptions` mirror.

## Setup
- Jest unit specs in `libs/nestjs`, no server or containers required.
- For [TASK-2150]: import the exported `stripSigV4QueryAuth` from
  `s3/sigv4/presigned.ts` and drive it directly; optionally construct the
  serializer factory and feed it a fake `req` (`{ method, url, headers, remoteAddress }`).
- For [TASK-2151]: reuse the `env.schema.spec.ts` `baseEnv` helper (a documented
  valid env with a **CSPRNG-style** secret, e.g.
  `JWT_SECRET: crypto.randomBytes(32).toString('base64')`) and call `loadEnv`;
  for the library mirror, build a `ResolvedOpenBucketOptions` and call
  `validateSecurityCriticalOptions`.

## Cases
1. **Signature + credential stripped.** Given
   `url = '/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260704%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=deadbeefcafef00d&X-Amz-Expires=604800'`,
   when passed through the serializer / `stripSigV4QueryAuth`, then the result
   contains neither `deadbeefcafef00d` nor `AKIAEXAMPLE`, and still contains the
   pathname `/bucket/key` and `X-Amz-Expires=604800`.
2. **Security token stripped.** Given a URL that also carries
   `&X-Amz-Security-Token=FwoGZ...`, when sanitized, then `X-Amz-Security-Token`
   and its value are absent from the output.
3. **Benign query preserved.** Given `url = '/bucket/key?prefix=logs%2F&max-keys=100'`
   (no SigV4 params), when sanitized, then the output equals the input
   (path + both query params intact).
4. **Malformed URL never throws.** Given `url = '://%%%not-a-url'`, when passed to
   the serializer, then it returns a string (falls back to the pre-`?` substring)
   and does not throw.
5. **Repeated-char JWT_SECRET rejected.** Given `baseEnv` with
   `JWT_SECRET = 'a'.repeat(32)`, when `loadEnv` runs, then it throws
   `Refusing to boot: invalid environment.` and stderr lists a `JWT_SECRET`
   reason (e.g. "must not be a single repeated character").
6. **Placeholder secret rejected.** Given `baseEnv` with
   `ROOT_SECRET_ACCESS_KEY = 'changeme'.padEnd(32, 'x')` matching a denylist entry
   (or `'changeme'` repeated to ≥32), when `loadEnv` runs, then it throws and
   stderr lists a `ROOT_SECRET_ACCESS_KEY` reason.
7. **Strong secret accepted.** Given `baseEnv` with
   `JWT_SECRET = crypto.randomBytes(33).toString('base64')` (44 chars, high
   distinct-char count), when `loadEnv` runs, then it does not throw.
8. **Library mirror stays in sync.** Given a `ResolvedOpenBucketOptions` whose
   `admin.jwtSecret = 'x'.repeat(40)` (all-identical), when
   `validateSecurityCriticalOptions` runs, then it throws with a
   `admin.jwtSecret` reason; the same options with a random base64 secret pass.

## Tooling
- Framework: jest
- Runner: `nx test nestjs --testPathPattern='presigned|env.schema.spec|open-bucket-options'`

## Pass criteria
- [ ] All 8 cases pass.
- [ ] No log-serializer output contains an `X-Amz-Signature` / `X-Amz-Credential`
      / `X-Amz-Security-Token` value (cases 1–2).
- [ ] The config gate rejects weak secrets and accepts CSPRNG secrets in both the
      standalone and library paths (cases 5–8), preserving refuse-to-boot semantics.

## References
- White-box security audit, 2026-07-04 — findings [7] (CWE-532) and [18] (CWE-521).
- `libs/nestjs/src/lib/open-bucket-core.module.ts:68-85`;
  `libs/nestjs/src/lib/s3/sigv4/presigned.ts:191`;
  `libs/nestjs/src/lib/common/config/env.schema.ts:19,36-38`;
  `libs/nestjs/src/lib/open-bucket-options.ts:172-190`.
