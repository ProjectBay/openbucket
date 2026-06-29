---
id: TASK-0312
title: Implement canonical-request builder and awsUriEncode
story: STORY-0103
status: done
type: implementation
size: M
---

## Description
Implement `buildCanonicalRequest` and the `awsUriEncode` helper per §2.4.5. Pure function (no Nest deps) consumed by both the header path (`Sigv4Verifier`) and the presigned path (`verifyPresigned`).

## Files to create / modify
- `apps/backend/src/s3/sigv4/canonical-request.ts` — new

## Implementation notes
- Verbatim signatures from §2.4.5 (lines 1856–1937):
  ```ts
  export interface CanonicalRequestInput {
    method: string;
    pathname: string;                                 // already URL-decoded once
    query: string;                                    // raw query, no leading '?'
    headers: Record<string, string | string[] | undefined>;
    signedHeaders: string[];                          // lowercase, alpha-sorted
    payloadHash: string;
  }

  export function buildCanonicalRequest(c: CanonicalRequestInput): string {
    // 1. CanonicalURI: S3 uses single-pass URI encoding of each path segment.
    // 2. CanonicalQueryString: sort by key, then by value; URI-encode both.
    // 3. CanonicalHeaders: each signed header, lower-cased name, trimmed value,
    //    sequential whitespace collapsed, terminated with '\n'.
  }
  ```
- Header line: `${name.toLowerCase()}:${value.trim().replace(/\s+/g, ' ')}\n`.
- Canonical output joins `[method.toUpperCase(), canonicalUri, canonicalQuery, headerLines.join(''), signedHeadersLine, payloadHash].join('\n')`.
- `canonicaliseQuery(q)`: split `&`, decode then re-encode each key/value with `awsUriEncode(_, true)`, sort by `(k, v)` lexicographic.
- `awsUriEncode(input, encodeSlash)`: AWS-flavoured RFC 3986: unreserved = `ALPHA / DIGIT / '-' / '.' / '_' / '~'`. Slashes preserved in path segments only when `encodeSlash === false`. Encodes via `'%' + byte.toString(16).toUpperCase().padStart(2, '0')`.

## Acceptance criteria
- [ ] `awsUriEncode` matches AWS reference test vectors for printable ASCII, UTF-8, and reserved characters.
- [ ] `canonicaliseQuery` sorts keys then values per RFC.
- [ ] Cross-check fixture: sign a request with `aws4.sign` and verify the canonical request string we build equals theirs (per §2.4.5 lines 1940–1944).

## Test obligations
- Unit: covered by [TEST-0104]
- E2E: N/A
- Conformance: N/A — exercised via header guard tests

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.4.5 (lines 1853–1944)
