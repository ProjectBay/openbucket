---
id: TASK-0923
title: Implement AbortMultipartHandler with session lookup and rows-first cleanup
story: STORY-0308
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/s3/multipart/abort-multipart.handler.ts` with the `AbortMultipartHandler` controller. Inject `ConfigService` and `MultipartService`. The `@Delete(':bucket/:key(*)')` handler validates the session, calls `multipart.abort({ uploadId })` first, then `rm(<dataDir>/multipart/<uploadId>, { recursive: true, force: true })`. Response status is `204`.

## Files to create / modify
- `apps/backend/src/s3/multipart/abort-multipart.handler.ts` — new

## Implementation notes
- Verbatim per §4.4.4:
  ```ts
  @Delete(':bucket/:key(*)')
  @HttpCode(204)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
  ): Promise<void> {
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    await this.multipart.abort({ uploadId });
    await rm(join(this.config.dataDir, 'multipart', uploadId), {
      recursive: true,
      force: true,
    });
  }
  ```
- Quote §4.4.4: "Order: rows first, then filesystem. If we crash between the two, the multipart-cleanup tick (§4.9) will pick up the directory by mtime."

## Acceptance criteria
- [ ] Missing session raises `S3Error('NoSuchUpload', 'Upload <uploadId> not found')`.
- [ ] `multipart.abort` is called before `rm`.
- [ ] `rm` uses `{ recursive: true, force: true }`.
- [ ] HTTP status code is `204`.

## Test obligations
- Unit: covered by [TEST-0313]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0915]

## References
- `docs/WHITEPAPER.md` §4.4.4 (lines 5994–6032)
