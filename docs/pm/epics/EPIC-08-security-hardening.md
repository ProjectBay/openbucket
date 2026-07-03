---
id: EPIC-08
title: Security hardening (audit remediation)
status: ready
whitepaper_section: "cross-cutting (§1, §2, §5)"
owner_area: backend
---

## Objective

Remediate the findings of the July 2026 white-box security audit so that
`@openbucket/nestjs` is safe to embed in a hostile-internet deployment. The audit
reviewed 13 attack surfaces (SigV4 auth, admin JWT, path traversal, backup/restore
ZIP, SPA serving, persistence/SQLi, XML/XXE, SSE crypto, authorization, DoS,
secrets/config, HTTP hardening, supply chain) with independent adversarial
verification of every finding, and confirmed **22 issues**: 1 critical, 1 high,
7 medium, 7 low, 6 info. This Epic closes each confirmed finding with a specific
fix and a regression test, and adds the missing baseline controls (a real
authorization layer, response-hardening headers, and resource limits) that the
audit showed are absent.

The single most urgent item is an **unauthenticated admin-API bypass** (CWE-178):
the global `JwtAuthGuard` gates auth on a case-sensitive path prefix while Express
routes case-insensitively, so `GET /api/Admin/backup` reaches the real handler with
no token — exposing whole-instance backup download, bucket CRUD, and S3 access-key
minting to any anonymous caller. It must ship first, as a patch release.

## Scope

- In scope:
  - Fix the critical case-sensitivity admin-auth bypass and make the admin guard
    fail-closed (case-insensitive compare + strict/case-sensitive routing +
    per-controller guard binding). [STORY-0700]
  - Session/refresh-token revocation on password change; enforce
    `mustChangePassword`. [STORY-0700]
  - HTTP response hardening: enable a Content-Security-Policy, force safe
    `Content-Type`/`Content-Disposition` on S3 object GETs (stored-XSS), restore
    per-request/socket timeouts (slowloris), and close the CORS bucket-existence
    enumeration oracle. [STORY-0701]
  - Implement bucket-policy evaluation (the policy authorization surface is
    currently inert) and enforce SignedHeaders coverage of mandatory headers.
    [STORY-0702]
  - SSE correctness: decrypt-then-re-encrypt on server-side CopyObject; document
    and, where feasible, strengthen the SSE key model. [STORY-0703]
  - Resource limits: storage quota + max-object-size review, S3-surface rate
    limiting, restore decompression-bomb / manifest size caps, ListParts
    pagination. [STORY-0704]
  - Secrets & logging: redact SigV4 query signatures and access-key IDs from logs;
    strengthen secret-entropy validation. [STORY-0705]
  - Input/filesystem hardening: aggregate key-length/path-depth cap; realpath
    symlink check in SPA serving; escape LIKE metacharacters in prefix filters.
    [STORY-0706]
  - Supply-chain hygiene: disable `@scarf/scarf` install telemetry; move `@nx/nest`
    out of production dependencies; add a CI `npm audit` gate. [STORY-0707]
- Out of scope:
  - New authentication mechanisms beyond the existing SigV4 + admin JWT model
    (e.g. OIDC, IAM policies) — future epic.
  - Formal threat model / STRIDE document (may follow as a spike).
  - Frontend (admin SPA) application-security review beyond the token-theft vector
    covered in [STORY-0701].

## Success criteria

- A request to any mixed-case admin path (`/api/Admin/*`, `/API/ADMIN/*`) without a
  valid bearer token returns 401 — verified by regression test.
- Every confirmed finding (22) has a landed fix and a test asserting the fixed
  behavior; the audit's critical and high findings are closed in a released patch.
- Bucket policies with an explicit `Deny` (and `Allow` for anonymous principals)
  are enforced on the S3 path — a policy that denies `s3:GetObject` blocks the GET.
- A crafted decompression-bomb restore archive is rejected before exhausting disk,
  and an existing instance is not destroyed by a failed restore.
- `npm audit --omit=dev` reports no high/critical advisories in CI, and request
  logs contain no SigV4 signatures or secret-access-key material.

## Stories

- [STORY-0700] Admin authentication & session hardening (critical bypass) — tasks TASK-2100..2109, test TEST-0700
- [STORY-0701] HTTP response & transport hardening (CSP, XSS, slowloris, enum) — tasks TASK-2110..2119, test TEST-0701
- [STORY-0702] Authorization enforcement: bucket policy & presign scope — tasks TASK-2120..2129, test TEST-0702
- [STORY-0703] Server-side encryption correctness (copy, key model) — tasks TASK-2130..2139, test TEST-0703
- [STORY-0704] Resource limits & DoS resilience (quota, rate limit, zip-bomb) — tasks TASK-2140..2149, test TEST-0704
- [STORY-0705] Secrets & logging hygiene — tasks TASK-2150..2159, test TEST-0705
- [STORY-0706] Input validation & filesystem hardening — tasks TASK-2160..2169, test TEST-0706
- [STORY-0707] Supply-chain & dependency hygiene — tasks TASK-2170..2179, test TEST-0707

## Dependencies

- Blocks: (a hardened 0.1.x line / 1.0 readiness)
- Blocked by: none — remediation of existing code.

## References

- White-box security audit, 2026-07-04 (22 confirmed findings; adversarially verified).
- `SECURITY.md` — coordinated-disclosure policy.
- Prior hardening: `EPIC-03` (persistence/storage), the F1–F11 fault-injection audit
  (durability/consistency).
