---
id: TASK-2150
title: Redact SigV4 signature and access-key id in request logs
story: STORY-0705
status: ready
type: implementation
size: S
---

## Description
Remediates audit finding [7] (medium, CWE-532 Insertion of Sensitive Information
into Log File). The Pino request serializer logs the raw request URL, and the
`redact` block only covers headers, so SigV4 **presigned** requests leak
`X-Amz-Signature` (a replayable request signature) and `X-Amz-Credential` (the
access-key-id) into stdout on every request. Sanitize the URL inside the
serializer — strip the SigV4 query-auth params before the value is logged — so no
completion line carries a replayable presigned credential.

## Files to create / modify
- `libs/nestjs/src/lib/open-bucket-core.module.ts` — modify. Replace the `req`
  serializer's `url: req.url` (line 81) with a sanitized URL that has
  `X-Amz-Signature`, `X-Amz-Credential`, and `X-Amz-Security-Token` removed /
  censored. Import the shared sanitizer.
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts` — modify. Generalize the existing
  private `stripParam(url, name)` helper (line 191) into an exported
  `stripSigV4QueryAuth(url: string): string` (or a small `redactUrlForLog`) that
  deletes all three SigV4 query params in one pass, and reuse it from the
  serializer. Keep `stripParam` for the canonical-query use at line 73.

## Implementation notes
- The vulnerable serializer (open-bucket-core.module.ts:78-85):
  ```ts
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,              // <-- leaks the whole query string
      host: req.headers.host,
      remoteAddress: req.remoteAddress,
    }),
  },
  ```
- The `redact` block (open-bucket-core.module.ts:68-77) only lists header paths
  (`req.headers.authorization`, `req.headers["x-amz-content-sha256"]`,
  `req.headers["x-amz-security-token"]`, `req.headers.cookie`,
  `res.headers["set-cookie"]`). Pino `redact` addresses object properties by path
  and **cannot** censor a substring inside a string, and the serializer emits `url`
  as one opaque string with no `query` object — so adding
  `req.query["X-Amz-Signature"]` paths would be a no-op. The fix must be in the
  serializer, not the redact list.
- Presigned URLs carry credentials in the query, never in headers
  (`presigned.ts:38-42`): `X-Amz-Credential` embeds the access-key-id,
  `X-Amz-Signature` is the signature, `X-Amz-Security-Token` is optional. These
  land verbatim inside `req.url`.
- The existing helper already does exactly the right operation for one param:
  ```ts
  function stripParam(url: string, name: string): string {
    const u = new URL(`http://h${url}`);
    u.searchParams.delete(name);
    return u.search.startsWith('?') ? u.search.slice(1) : u.search;
  }
  ```
  Generalize it to delete the three SigV4 auth params and return the full
  `pathname + search`, e.g.:
  ```ts
  export function stripSigV4QueryAuth(url: string): string {
    const u = new URL(`http://h${url}`);
    for (const p of ['X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Security-Token']) {
      u.searchParams.delete(p);
    }
    return u.pathname + (u.search || '');
  }
  ```
  Then in the serializer: `url: stripSigV4QueryAuth(req.url)`. Preserve benign
  query params so ordinary request URLs stay debuggable. Guard against a malformed
  `req.url` (fall back to `req.url.split('?')[0]` on `URL` throw) so logging never
  crashes a request.
- CWE-532. Leaked material is a bearer signature scoped to one op/one object,
  valid only within the presign window (up to 7 days), and exposure requires
  log-read access — hence medium, not higher. Stripping the whole SigV4 auth set
  (rather than only the signature) is preferred so a future added `X-Amz-*` auth
  param is covered by the same seam.

## Acceptance criteria
- [ ] A presigned request URL passed through the serializer yields a `url` string
      that contains neither the `X-Amz-Signature` value nor the `X-Amz-Credential`
      value (covered by [TEST-0705] case 1).
- [ ] `X-Amz-Security-Token` is also absent from the logged `url` (case 2).
- [ ] A non-presigned URL with benign query params logs those params unchanged
      (case 3).
- [ ] A malformed `req.url` does not throw inside the serializer (case 4).
- [ ] `nx test nestjs --testPathPattern=presigned` and the logging spec pass.

## Test obligations
- Unit: covered by [TEST-0705] (serializer sanitization + `stripSigV4QueryAuth`).
- E2E: N/A — asserted at the serializer/helper unit boundary.
- Conformance: N/A.

## Dependencies
- Blocked by: none. Independent of [TASK-2151]; both land under [STORY-0705].
  Should merge behind [STORY-0700] `TASK-2100` (critical P0).

## References
- White-box security audit, 2026-07-04 — finding [7] (CWE-532).
- `libs/nestjs/src/lib/open-bucket-core.module.ts:68-85`.
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts:38-42,73,147,150,174,191`.
