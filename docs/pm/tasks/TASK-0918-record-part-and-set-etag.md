---
id: TASK-0918
title: Record the part and set the part ETag header
story: STORY-0306
status: done
type: implementation
size: XS
---

## Description
After the rename, await `ctx.hashes` and `ctx.size`, call `multipart.recordPart({ uploadId, partNumber, size, etag: md5Hex })`, and set the response header `ETag: "<md5Hex>"`.

## Files to create / modify
- `apps/backend/src/s3/multipart/upload-part.handler.ts` — modify

## Implementation notes
- Verbatim per §4.4.2:
  ```ts
  const { md5Hex } = await ctx.hashes;
  const size = await ctx.size;

  await this.multipart.recordPart({
    uploadId, partNumber, size, etag: md5Hex,
  });

  res.setHeader('ETag', `"${md5Hex}"`);
  ```

## Acceptance criteria
- [ ] `recordPart` receives the exact field shape `{ uploadId, partNumber, size, etag: md5Hex }`.
- [ ] Response header `ETag` is the quoted lowercase hex MD5.

## Test obligations
- Unit: covered by [TEST-0311]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0917]

## References
- `docs/WHITEPAPER.md` §4.4.2 (lines 5850–5861)
