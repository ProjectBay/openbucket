---
id: TASK-0922
title: Compose blobs, recordPut, and finalize multipart session
story: STORY-0307
status: done
type: implementation
size: S
---

## Description
After validation and ETag computation, call `blobs.composeBlobs({ bucket, key, partPaths })` to produce the final blob, call `objects.recordPut({ bucket, key, size, etag: finalEtag, sha256: undefined, contentType, blobPath })`, then `multipart.complete({ uploadId })` to discard the staging area. Set `x-amz-version-id` when versioning emits one. Return `{ bucket, key, etag, location: '/<bucket>/<key>' }`.

## Files to create / modify
- `apps/backend/src/s3/multipart/complete-multipart.handler.ts` — modify

## Implementation notes
- Verbatim per §4.4.3:
  ```ts
  const composed = await this.blobs.composeBlobs({ bucket, key, partPaths });

  // (etag computed in [TASK-0921])

  const version = await this.objects.recordPut({
    bucket, key,
    size: composed.size,
    etag: finalEtag,
    sha256: undefined,
    contentType: session.contentType ?? 'application/octet-stream',
    blobPath: composed.path,
  });

  await this.multipart.complete({ uploadId });

  if (version.versionId) {
    res.setHeader('x-amz-version-id', version.versionId);
  }

  return {
    bucket, key,
    etag: finalEtag,
    location: `/${bucket}/${key}`,
  };
  ```
- `sha256: undefined` because per §4.4.3 "not computed for multipart in v1".

## Acceptance criteria
- [ ] `composeBlobs` is called with `{ bucket, key, partPaths }` and the result feeds `recordPut`.
- [ ] `recordPut` receives `sha256: undefined`.
- [ ] `multipart.complete({ uploadId })` runs after `recordPut`.
- [ ] Return value is exactly `{ bucket, key, etag, location: '/<bucket>/<key>' }`.
- [ ] `x-amz-version-id` is set iff `version.versionId` is truthy.

## Test obligations
- Unit: covered by [TEST-0312]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0921]

## References
- `docs/WHITEPAPER.md` §4.4.3 (lines 5957–5990)
