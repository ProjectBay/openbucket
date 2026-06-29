---
id: TASK-0903
title: Validate x-amz-content-sha256 header branch and reject chunked uploads
story: STORY-0301
status: done
type: implementation
size: XS
---

## Description
In `PutObjectInterceptor.intercept`, read `x-amz-content-sha256` and `content-md5` headers and branch on the SigV4-defined values: missing → `InvalidRequest`; literal `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` → `NotImplemented`; `UNSIGNED-PAYLOAD` → skip SHA-256 verification; hex → verify on flush.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.interceptor.ts` — modify

## Implementation notes
- Quote from §4.1.2:
  ```ts
  const expectedSha256 = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
  const expectedMd5Base64 = req.headers['content-md5'] as string | undefined;

  if (!expectedSha256) {
    return throwError(() => new S3Error('InvalidRequest', 'x-amz-content-sha256 is required'));
  }
  if (expectedSha256 === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD') {
    return throwError(() =>
      new S3Error('NotImplemented', 'Chunked uploads are not supported in v1'),
    );
  }
  const verifySha = expectedSha256 !== 'UNSIGNED-PAYLOAD';
  ```
- `verifySha` controls whether the flush compares the hex SHA-256.

## Acceptance criteria
- [ ] Missing header → `S3Error('InvalidRequest', 'x-amz-content-sha256 is required')`.
- [ ] `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` → `S3Error('NotImplemented', 'Chunked uploads are not supported in v1')`.
- [ ] `UNSIGNED-PAYLOAD` skips the SHA-256 check on flush.

## Test obligations
- Unit: covered by [TEST-0301]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0902]

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5293–5310)
