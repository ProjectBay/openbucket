---
id: TASK-0911
title: Set GET response headers before piping body
story: STORY-0303
status: done
type: implementation
size: XS
---

## Description
Set all GET response headers (`Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges`, optional `x-amz-version-id`, then status + `Content-Range` / `Content-Length`) before any body bytes are written, so Node's HTTP layer does not auto-emit headers and cause `setHeader` to throw.

## Files to create / modify
- `apps/backend/src/s3/object/get-object.handler.ts` — modify

## Implementation notes
- Verbatim per §4.2:
  ```ts
  res.setHeader('Content-Type', meta.contentType);
  res.setHeader('ETag', `"${meta.etag}"`);
  res.setHeader('Last-Modified', stats.mtime.toUTCString());
  res.setHeader('Accept-Ranges', 'bytes');
  if (meta.versionId) {
    res.setHeader('x-amz-version-id', meta.versionId);
  }
  ```
- For 206:
  ```ts
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  stream = createReadStream(blob.path, { start, end, highWaterMark: 256 * 1024 });
  ```
- For 200:
  ```ts
  res.status(200);
  res.setHeader('Content-Length', String(stats.size));
  stream = createReadStream(blob.path, { highWaterMark: 256 * 1024 });
  ```
- For 416 (invalid range):
  ```ts
  res.status(416);
  res.setHeader('Content-Range', `bytes */${stats.size}`);
  res.end();
  return;
  ```

## Acceptance criteria
- [ ] Headers are set before `stream.pipe(res)`.
- [ ] `highWaterMark: 256 * 1024` is used on `createReadStream` for both branches.
- [ ] 416 emits `Content-Range: bytes */<size>` and an empty body.

## Test obligations
- Unit: covered by [TEST-0305]
- E2E: covered by [TEST-0306]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0910]

## References
- `docs/WHITEPAPER.md` §4.2 (lines 5583–5602), §4.7 (line 6162)
