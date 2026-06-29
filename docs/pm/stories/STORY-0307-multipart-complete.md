---
id: STORY-0307
title: CompleteMultipartUpload with 5 MiB minimum and multipart-ETag
epic: EPIC-04
status: done
size: M
risk: high
---

## User story
As an S3 client, I want `POST /<bucket>/<key>?uploadId=` with my parts list to compose the final object and return the canonical multipart ETag, so that the assembled object is durable and the ETag matches the AWS formula.

## Description
Implement `apps/backend/src/s3/multipart/complete-multipart.handler.ts`. The handler validates the session, requires a non-empty parts list, requires the sorted parts to be contiguous from 1..N (else `InvalidPartOrder`), cross-checks declared vs. recorded ETags (else `InvalidPart`), verifies every part file exists via `stat`, enforces "all parts except the last must be ≥ 5 MiB" (else `EntityTooSmall`), composes the final blob via `BlobStore.composeBlobs({ bucket, key, partPaths })`, computes the multipart ETag as `md5(concat(md5(part1), md5(part2), ...)) + "-N"`, records the object via `ObjectService.recordPut(...)` with `sha256: undefined`, then calls `MultipartService.complete({ uploadId })` to discard the staging area. Sets `x-amz-version-id` when versioning emits one and returns `{ bucket, key, etag, location: '/<bucket>/<key>' }`.

## Acceptance criteria
- [ ] Empty parts list raises `S3Error('MalformedXML', 'CompleteMultipartUpload requires at least one part')`.
- [ ] Sorted parts that are not contiguous from 1 raise `S3Error('InvalidPartOrder', ...)`.
- [ ] A declared part with no recorded record raises `S3Error('InvalidPart', 'Part N was not uploaded')`.
- [ ] A declared ETag (with optional surrounding quotes) that does not match the recorded ETag raises `S3Error('InvalidPart', 'Part N ETag mismatch')`.
- [ ] A missing part file raises `S3Error('InvalidPart', 'Part file missing: <path>')`.
- [ ] Any part except the last whose size is `< 5 * 1024 * 1024` raises `S3Error('EntityTooSmall', 'Part N is smaller than 5 MiB')`.
- [ ] Final ETag equals `${md5(concat(md5(p1), md5(p2), ...))}-${N}` (lowercase hex, dash, count).
- [ ] `BlobStore.composeBlobs` is invoked with `{ bucket, key, partPaths }` in ascending part order.
- [ ] After success, `MultipartService.complete({ uploadId })` is called.
- [ ] Return value is `{ bucket, key, etag, location: '/<bucket>/<key>' }`.
- [ ] `nx test backend --testPathPattern=complete-multipart.handler.spec.ts` passes.

## Tasks
- [TASK-0919] Implement parts-list validation (sort, contiguous-from-1, declared ETag match)
- [TASK-0920] Implement part-file stat loop with 5 MiB minimum (last-part exempt)
- [TASK-0921] Implement multipart ETag computation `md5(concat(md5(part_i)))-N`
- [TASK-0922] Wire BlobStore.composeBlobs and ObjectService.recordPut then MultipartService.complete

## Test plan
- [TEST-0312] CompleteMultipartUpload unit tests (incl. 5 MiB and ETag formula)
- [TEST-0309] Multipart lifecycle e2e via supertest
- [TEST-0310] Multipart conformance with real S3 clients

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0302], [STORY-0305], [STORY-0306]

## References
- `docs/WHITEPAPER.md` §4.4.3 (lines 5865–5992)
- Interfaces consumed: `BlobStore.composeBlobs` (defined in [EPIC-03]), `ObjectService.recordPut` (defined in [EPIC-03]), `MultipartService.get/listParts/complete` (defined in [EPIC-03]), `CompletePartsRequest` DTO (defined in [EPIC-02])
- Interfaces produced: `CompleteMultipartHandler`
