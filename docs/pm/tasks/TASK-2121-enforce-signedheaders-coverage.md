---
id: TASK-2121
title: Enforce SignedHeaders coverage of host and present x-amz-* headers
story: STORY-0702
status: ready
type: implementation
size: S
---

## Description
Remediate audit finding [8] (CWE-345, Insufficient Verification of Data Authenticity). The `SignedHeaders` list is taken verbatim from the client and folded into the canonical request without any mandatory-header check: `parseAuthorization` (`sigv4.guard.ts`) returns `signedHeaders` split from the Authorization header, `verifyPresigned` splits `X-Amz-SignedHeaders` (`presigned.ts` ~:74), and `buildCanonicalRequest` folds only those named headers (`canonical-request.ts:29–34`). Unlike AWS, the server never requires `host` (nor every `x-amz-*` header actually present on the wire) to appear in `SignedHeaders`, so a signer may leave the `Host` header unbound. This Task adds the AWS mandatory-header rule on both SigV4 paths.

## Files to create / modify
- `libs/nestjs/src/lib/s3/sigv4/signed-headers.ts` — new. Shared helper `assertMandatorySignedHeaders(signedHeaders: string[], headers): void` used by both paths (single source of truth for the rule).
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts` — modify. In `checkHeader`, after `parseAuthorization`, call the helper with `parsed.signedHeaders` and `req.headers` before verification.
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts` — modify. In `verifyPresigned`, after computing `signedHeaders` (~:74), call the same helper against `req.headers`.
- `libs/nestjs/src/lib/s3/sigv4/signed-headers.spec.ts` — new. Unit spec (see [TEST-0702]).

## Implementation notes
- The defect, verbatim from finding [8]: "neither the header path (parseAuthorization, sigv4.guard.ts:147) nor the presigned path (presigned.ts:74) enforces that `host` appears in SignedHeaders, and buildCanonicalRequest (canonical-request.ts:29–34) only folds client-named headers, so an omitted `host` is unbound." `x-amz-content-sha256` (via `payloadHash`) and `x-amz-date` (via string-to-sign) stay bound regardless, so the residual gap is correctly scoped to `host` and to any other wire-present `x-amz-*` header the client leaves out of `SignedHeaders`.
- Intended fix, per finding [8] fix note: "after parsing SignedHeaders, reject the request unless the lowercased list contains `host`, and also reject if any header actually present on the wire whose name starts with `x-amz-` is missing from the SignedHeaders list (mirroring AWS's mandatory-header rule). Throw AccessDeniedError/SignatureDoesNotMatchError on violation."
- Helper contract: lowercase every entry in `signedHeaders`; if it does not include `host` → throw `AccessDeniedError`. Then for each request header name starting with `x-amz-` (case-insensitive) that is present on the wire and not in the signed set → throw `AccessDeniedError`. Throw the same error type on both paths so the guard surfaces a consistent 403 (`AccessDeniedError` for the header path; `verifyPresigned` throwing is fine — it already throws for missing params).
- This is a few lines with no protocol change: every mainstream AWS SDK/CLI already signs `host` and all `x-amz-*` headers, so compliant clients are unaffected (verdict on the finding was PLAUSIBLE / low — hardening/spec-conformance debt, not a reachable external exploit in the single-root model, but it restores the host-binding guarantee AWS clients assume).
- CWE: **CWE-345 Insufficient Verification of Data Authenticity**.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=signed-headers` passes: a `signedHeaders` list without `host` throws; a list where a present `x-amz-meta-*`/`x-amz-*` header is omitted throws; a fully-covering list passes.
- [ ] E2E/unit: a header-signed request whose `SignedHeaders=x-amz-date;x-amz-content-sha256` (no `host`) is rejected with `403 AccessDenied`; a presigned URL whose `X-Amz-SignedHeaders` omits `host` is rejected — asserted in [TEST-0702].
- [ ] Existing SigV4 header/presigned e2e and conformance suites ([TEST-0105], [TEST-0108], [TEST-0112], [TEST-0114]) pass unchanged — real SDK/CLI requests sign `host` and are unaffected.

## Test obligations
- Unit: covered by [TEST-0702] (`assertMandatorySignedHeaders` positive/negative cases).
- E2E: covered by [TEST-0702] (crafted request missing `host` in SignedHeaders → 403 on both paths).
- Conformance: N/A — guarded against regression by the existing SigV4 conformance runs.

## Dependencies
- Blocked by: [STORY-0103] (`SigV4Guard`, `parseAuthorization`), [STORY-0104] (`verifyPresigned`). Independent of [TASK-2120].

## References
- White-box security audit, 2026-07-04 — finding [8] (CWE-345).
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts` (`parseAuthorization` → `signedHeaders`), `libs/nestjs/src/lib/s3/sigv4/presigned.ts` (`X-Amz-SignedHeaders` ~:74), `libs/nestjs/src/lib/s3/sigv4/canonical-request.ts:29–34`
