---
id: TASK-0304
title: Implement MultipartController routes
story: STORY-0100
status: done
type: implementation
size: S
---

## Description
Implement `MultipartController` shell — most multipart routes are dispatched inside `ObjectController` (§2.1.1 PUT/POST/DELETE families). This controller carries any multipart-only logic that does not fit on the object route grammar.

## Files to create / modify
- `apps/backend/src/s3/controllers/multipart.controller.ts` — modify (implement)

## Implementation notes
- Per §2.1 line 1087: `multipart.controller.ts        // multipart sub-operations`.
- In practice the multipart routes are reached through `ObjectController.put/post/delete/get` which calls into `MultipartService`. The `MultipartController` is the home for any pure multipart endpoint that needs its own decoration (e.g. `ListMultipartUploads` at the bucket scope, when not folded into `BucketController`).
- Apply the same decorators (`SigV4Guard`, `S3ExceptionFilter`, `XmlInterceptor`).

## Acceptance criteria
- [ ] `MultipartController` is declared in `S3Module`.
- [ ] No route conflicts with `ObjectController` (NestJS resolves to the first matching controller).

## Test obligations
- Unit: covered by [TEST-0100]
- E2E: covered by [TEST-0117]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.1 (lines 1080–1108), §2.8.4 (lines 2565–2575)
