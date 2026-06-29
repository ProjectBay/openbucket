---
id: TEST-0312
title: CompleteMultipartUpload unit tests (incl. 5 MiB minimum and ETag formula)
covers: [STORY-0307, TASK-0919, TASK-0920, TASK-0921, TASK-0922]
status: backlog
level: unit
---

## Goal
Verify the validation pipeline of `CompleteMultipartHandler`, the multipart ETag formula `md5(concat(md5(part_i)))-N`, and the BlobStore.composeBlobs + ObjectService.recordPut + MultipartService.complete sequencing.

## Setup
- Real fs/promises against an OS temp `dataDir` containing the part files.
- Mock `BlobStore.composeBlobs`, `ObjectService.recordPut`, `MultipartService.{ get, listParts, complete }`.

## Cases
1. Given an empty parts list, then `S3Error('MalformedXML', 'CompleteMultipartUpload requires at least one part')`.
2. Given parts `[1, 2, 4]`, then `S3Error('InvalidPartOrder', ...)`.
3. Given a declared part with no recorded match, then `S3Error('InvalidPart', 'Part 3 was not uploaded')`.
4. Given a declared ETag (quoted or unquoted) that does not match the recorded ETag, then `S3Error('InvalidPart', 'Part 2 ETag mismatch')`.
5. Given a missing `<N>.part` file, then `S3Error('InvalidPart', 'Part file missing: <path>')`.
6. Given a middle part with `size < 5 * 1024 * 1024`, then `S3Error('EntityTooSmall', 'Part N is smaller than 5 MiB')`.
7. Given a last part with `size < 5 * 1024 * 1024`, then the validation passes (last part is exempt).
8. Given 3 parts with known MD5 hexes `a`, `b`, `c`, then `finalEtag === md5(concat(hex2buf(a), hex2buf(b), hex2buf(c)))-3` (verified by independent hash computation).
9. Given a successful run, then `BlobStore.composeBlobs` is called with `partPaths` in ascending order, `ObjectService.recordPut` is called with `sha256: undefined`, and `MultipartService.complete({ uploadId })` is called after.
10. Given `recordPut` returns `{ versionId: 'v1' }`, then `res.setHeader('x-amz-version-id', 'v1')` is called.
11. Return value equals `{ bucket, key, etag, location: '/<bucket>/<key>' }`.

## Tooling
- Framework: jest, fs/promises
- Runner: `nx test backend --testPathPattern=complete-multipart.handler.spec.ts`

## Pass criteria
- [ ] All eleven cases pass.

## References
- `docs/WHITEPAPER.md` §4.4.3 (lines 5865–5992)
