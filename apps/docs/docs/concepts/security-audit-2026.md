---
title: Security audit (2026)
description: Summary of the July 2026 white-box security audit of OpenBucket — 22 findings across 13 attack surfaces, all remediated and shipped, each with a regression test.
sidebar_position: 5
---

# Security audit (2026)

In July 2026, OpenBucket underwent an independent **white-box security audit**
before its first tagged releases. We're publishing the result in full — including
the critical finding — because for a store that holds your data, an audit you
survived _transparently_ is worth more than silence.

## Scope

The audit reviewed **13 attack surfaces** with independent adversarial
verification of every finding:

> SigV4 auth · admin JWT · path traversal · backup/restore ZIP handling · SPA
> serving · persistence / SQL injection · XML / XXE · SSE crypto · authorization
> · denial-of-service · secrets & config · HTTP hardening · supply chain

It confirmed **22 issues: 1 critical, 1 high, 7 medium, 7 low, 6 informational.**

## Result

:::tip All findings remediated
Every confirmed finding was fixed — each with a regression test — and shipped in
**`v0.1.0-alpha.8`** (2026-07-04). See the
[CHANGELOG](https://github.com/ProjectBay/openbucket/blob/main/CHANGELOG.md#010-alpha8--2026-07-04)
for the full per-finding entry.
:::

## Findings & remediation

| Severity | Finding | Status |
| --- | --- | --- |
| **Critical** | **Unauthenticated admin-API bypass (CWE-178).** The admin JWT guard gated auth on a case-**sensitive** path prefix while Express routes case-**insensitively**, so `GET /api/Admin/backup` reached the admin handler with no token — exposing whole-instance backup download, bucket CRUD, and S3 access-key minting to anonymous callers. | ✅ Fixed in `alpha.8` — the guard now compares case-insensitively and fail-closed; regression tests assert mixed-case admin paths return 401. |
| **High** | **Stored XSS → admin token theft.** Attacker-controlled object `Content-Type` was served inline on the app origin. | ✅ Fixed — a Content-Security-Policy is enforced and S3 object GETs carry safe `Content-Type` / `Content-Disposition`. |
| **Medium/Low** | **Bucket policies were stored but inert** (not evaluated). | ✅ Fixed — bucket policies are now evaluated through the same policy engine as scoped keys; explicit `Deny` is enforced (default-allow, so credentialed access is unaffected). |
| **Medium** | Sessions/refresh tokens not revoked on password change; `mustChangePassword` advisory-only. | ✅ Fixed — revoked on password change; enforced. |
| **Medium** | Server-side `CopyObject` streamed SSE ciphertext as plaintext. | ✅ Fixed — decrypt-then-re-encrypt on copy. |
| **Medium** | DoS surface: no request/socket timeouts (slowloris), no storage quota, unbounded restore decompression, unbounded manifest read, no S3 rate limiting, missing `ListParts` pagination. | ✅ Fixed — timeouts restored, storage quota, decompression-bomb + manifest caps, S3 rate limiting, paginated `ListParts`. |
| **Low** | SigV4 signatures + access-key IDs leaked into logs. | ✅ Fixed — redacted from logs. |
| **Low** | CORS preflight bucket-existence enumeration oracle. | ✅ Fixed — opaque preflight. |
| **Low** | `SignedHeaders` coverage of mandatory headers not enforced. | ✅ Fixed — coverage enforced. |
| **Info** | Aggregate key-length cap; SPA symlink/realpath check; `LIKE`-metacharacter escaping in prefix filters; low-entropy secret rejection; disabled `@scarf/scarf` install telemetry; moved `@nx/nest` out of production dependencies with an `npm audit` CI gate. | ✅ Fixed. |

Backup/restore ZIP handling was reviewed for zip-slip / path-traversal and found
**correctly closed** (triple validation + key-codec re-encoding).

## Ongoing security posture

- **Coordinated disclosure.** Report vulnerabilities privately per our
  [SECURITY.md](https://github.com/ProjectBay/openbucket/blob/main/SECURITY.md)
  (3-day acknowledgement). GitHub Security Advisories are enabled.
- **CI gates.** Every build runs `npm audit --audit-level=high` and CodeQL
  (`security-and-quality` query suite).
- **Out of scope / follow-up.** A formal STRIDE threat model is planned as a
  future spike. New auth mechanisms (OIDC, full IAM policies) are a future epic.

For the design-level view of how OpenBucket authenticates and authorizes every
request, see the [Security model](./security-model.md).
