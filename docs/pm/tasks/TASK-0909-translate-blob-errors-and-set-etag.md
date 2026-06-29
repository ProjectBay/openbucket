---
id: TASK-0909
title: Translate BlobStore errors and set ETag / x-amz-version-id headers
story: STORY-0302
status: done
type: implementation
size: XS
---

## Description
Wrap the `blobs.putBlob` call in a `try/catch` that rethrows `S3Error` as-is and wraps non-`S3Error` exceptions as `S3Error('InternalError', (err as Error).message, { cause: err })`. After `recordPut`, set `ETag: "<md5Hex>"` and (when `version.versionId` is present) `x-amz-version-id`.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.handler.ts` — modify

## Implementation notes
- Verbatim block per §4.1.3:
  ```ts
  try {
    putResult = await this.blobs.putBlob({
      bucket, key, source: ctx.stream,
      expectedLength: contentLength ? Number(contentLength) : undefined,
    });
  } catch (err) {
    if (err instanceof S3Error) throw err;
    throw new S3Error('InternalError', (err as Error).message, { cause: err });
  }
  ```
- Verbatim header setting:
  ```ts
  res.setHeader('ETag', `"${md5Hex}"`);
  if (version.versionId) {
    res.setHeader('x-amz-version-id', version.versionId);
  }
  ```

## Acceptance criteria
- [ ] `S3Error` exceptions from `putBlob` propagate unchanged.
- [ ] Other exceptions become `S3Error('InternalError', ...)` carrying the original `cause`.
- [ ] `ETag` is quoted, lowercase hex.
- [ ] `x-amz-version-id` is set iff `version.versionId` is truthy.

## Test obligations
- Unit: covered by [TEST-0303]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0908]

## References
- `docs/WHITEPAPER.md` §4.1.3 (lines 5457–5489)
