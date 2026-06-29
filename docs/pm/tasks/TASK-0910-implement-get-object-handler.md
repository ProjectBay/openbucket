---
id: TASK-0910
title: Implement GetObjectHandler with metadata and blob lookup
story: STORY-0303
status: done
type: implementation
size: S
---

## Description
Create `apps/backend/src/s3/object/get-object.handler.ts` with the `GetObjectHandler` controller. Inject `BlobStore` and `ObjectService`. The `@Get(':bucket/:key(*)')` method looks up `objects.head({ bucket, key })`, then `blobs.getBlob({ bucket, key, versionId: meta.versionId })`, then `stat(blob.path)` to obtain the authoritative byte count.

## Files to create / modify
- `apps/backend/src/s3/object/get-object.handler.ts` — new

## Implementation notes
- Constructor signature per §4.2:
  ```ts
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}
  ```
- Missing meta → `throw new S3Error('NoSuchKey', \`${bucket}/${key} not found\`);`
- Missing blob → `throw new S3Error('NoSuchKey', \`Blob missing for ${bucket}/${key}\`);`
- Quote §4.2: "Stat the file fresh — meta.size may be authoritative but the blob file is the actual byte count we're going to send."

## Acceptance criteria
- [ ] Handler compiles with the constructor and decorators per §4.2.
- [ ] Missing metadata raises `S3Error('NoSuchKey', ...)`.
- [ ] Missing blob raises `S3Error('NoSuchKey', 'Blob missing for <bucket>/<key>')`.

## Test obligations
- Unit: covered by [TEST-0305]
- E2E: covered by [TEST-0306]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0909], [TASK-0913]

## References
- `docs/WHITEPAPER.md` §4.2 (lines 5523–5580)
