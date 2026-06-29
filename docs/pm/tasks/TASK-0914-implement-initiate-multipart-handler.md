---
id: TASK-0914
title: Implement InitiateMultipartHandler with mkdir + service.initiate
story: STORY-0305
status: done
type: implementation
size: S
---

## Description
Create `apps/backend/src/s3/multipart/initiate-multipart.handler.ts` with the `InitiateMultipartHandler` controller. Inject `ConfigService` and `MultipartService`. The `@Post(':bucket/:key(*)')` handler creates `<dataDir>/multipart/<uploadId>/` with `mkdir(..., { recursive: true, mode: 0o700 })`, calls `multipart.initiate({ uploadId, bucket, key })`, and returns the structured value `{ bucket, key, uploadId }`.

## Files to create / modify
- `apps/backend/src/s3/multipart/initiate-multipart.handler.ts` — new

## Implementation notes
- Verbatim from §4.4.1:
  ```ts
  const uploadId = randomUUID();
  const dir = join(this.config.dataDir, 'multipart', uploadId);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  await this.multipart.initiate({ uploadId, bucket, key });

  res.status(200);
  return { bucket, key, uploadId };
  ```
- `@HttpCode(200)` on the method.

## Acceptance criteria
- [ ] Handler returns `{ bucket, key, uploadId }`.
- [ ] Directory created at `<dataDir>/multipart/<uploadId>/` with mode `0o700`.
- [ ] `multipart.initiate` is called with `{ uploadId, bucket, key }`.

## Test obligations
- Unit: covered by [TEST-0308]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.4.1 (lines 5726–5763)
