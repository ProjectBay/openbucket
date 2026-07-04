---
id: TASK-2112
title: Collapse the CORS preflight branches to remove the bucket-enumeration oracle
story: STORY-0701
status: ready
type: implementation
size: XS
---

## Description
Remediates audit finding [14] (LOW, CWE-203 observable discrepancy). The CORS preflight controller is unauthenticated by design (AWS does not sign preflights) and returns three distinguishable outcomes for `OPTIONS /:bucket`: `NoSuchBucket` (404) when the bucket does not exist, `NoSuchCORSConfiguration` (404) when it exists but has no CORS rules, and `AccessDenied` (403) when it exists but no rule matches. An anonymous attacker can diff these responses to enumerate which bucket names exist with no credentials. This task collapses the pre-authorization outcomes into one opaque `403 AccessDenied` so existence is not observable.

## Files to create / modify
- `libs/nestjs/src/lib/s3/cors/cors.controller.ts` — modify. In `preflight()`, replace the distinguishable not-found / no-CORS / no-match throws (lines 58, 62, 71) with a single uniform `AccessDeniedError` for all non-matching cases.

## Implementation notes
- CWE-203 (Observable Discrepancy). The controller has no `@UseGuards(SigV4Guard)` (mounted anonymously in `S3Module`), and `S3ExceptionFilter` serializes `err.code` into the XML `<Code>` element, so the two 404 bodies (`NoSuchBucket` vs `NoSuchCORSConfiguration`) are distinguishable on the wire and the 403 by status.
- Vulnerable branches in `cors.controller.ts` `preflight()`:
  ```ts
  const bucketRow = await this.buckets.findByName(bucket);
  if (!bucketRow) throw new NoSuchBucketError(bucket);            // line 58 — leaks "does not exist"
  const rules = bucketRow.cors;
  if (!rules || rules.length === 0) {
    throw new NoSuchCORSConfigurationError('CORSResponse: CORS is not enabled for this bucket.'); // line 62 — leaks "exists, no CORS"
  }
  const rule = rules.find(...);
  if (!rule) throw new AccessDeniedError('CORSResponse: This CORS request is not allowed.'); // line 71
  ```
- Fix, per the audit fix note: treat a null `bucketRow` (line 58) and the empty/no-match cases (lines 62, 71) identically — throw one uniform `AccessDeniedError('CORSResponse: This CORS request is not allowed.')` (403) for all three. Only a genuine rule match then yields `200` + ACAO headers, which reveals existence solely for buckets whose owner deliberately published a matching CORS rule (an intentional public surface). Concretely, drop the `NoSuchBucketError` and `NoSuchCORSConfigurationError` throws from the preflight path and fall through to the same `AccessDeniedError` the no-match branch already uses.
- This preserves browser CORS semantics (browsers only act on the `200` + `Access-Control-Allow-Origin` on a successful match) while removing the anonymous `NoSuchBucket`-vs-`NoSuchCORSConfiguration`-vs-`AccessDenied` diff.
- Keep the existing non-CORS `OPTIONS` behavior (no `Origin`/`Access-Control-Request-Method` → `200` + `Allow` header) unchanged; the oracle is only in the CORS-preflight code path.
- Optional (defense-in-depth, not required here): retain AWS-parity `NoSuchBucket` only on the authenticated bucket routes, which already require SigV4.
- The unused `NoSuchBucketError` / `NoSuchCORSConfigurationError` imports in `cors.controller.ts` should be removed if no longer referenced.

## Acceptance criteria
- [ ] `OPTIONS /:bucket` (with `Origin` + `Access-Control-Request-Method`) returns byte-identical `403 AccessDenied` responses for: (a) a non-existent bucket, (b) an existing bucket with no CORS config, (c) an existing bucket whose rules do not match the request.
- [ ] An existing bucket with a matching CORS rule still returns `200` with the correct `Access-Control-Allow-Origin`/`-Methods` headers.
- [ ] The response `<Code>` no longer distinguishes `NoSuchBucket` from `NoSuchCORSConfiguration` on the unauthenticated preflight path.
- [ ] `nx test nestjs --testPathPattern=cors.controller` asserts the three non-matching cases are indistinguishable.

## Test obligations
- Unit: covered by [TEST-0701] (assert equal status + body for missing/no-CORS/no-match preflights).
- E2E: covered by [TEST-0701] (anonymous `OPTIONS` enumeration attempt yields uniform 403).
- Conformance: N/A — this is a deliberate, documented deviation from AWS's `NoSuchBucket` preflight parity to close the oracle; browser CORS behavior is unaffected.

## Dependencies
- Blocked by: _none_ (independent of the other STORY-0701 tasks).

## References
- White-box security audit, 2026-07-04 — finding [14] (LOW, CWE-203).
- `libs/nestjs/src/lib/s3/cors/cors.controller.ts:58,62,71`; `libs/nestjs/src/lib/s3/errors/s3-exception.filter.ts` (serializes `err.code` into `<Code>`).
