---
id: TASK-0303
title: Implement ServiceController for root GET (ListBuckets entry)
story: STORY-0100
status: done
type: implementation
size: XS
---

## Description
Implement the `ServiceController` declaring `GET /` only — the ListBuckets entrypoint. This Story owns the wiring; the actual handler body is realized in STORY-0107 / TASK-0322.

## Files to create / modify
- `apps/backend/src/s3/controllers/service.controller.ts` — modify (implement)

## Implementation notes
- Per §2.1 line 1084: `service.controller.ts          // GET /  -> ListBuckets`.
- Apply `@Controller() @UseGuards(SigV4Guard) @UseFilters(S3ExceptionFilter) @UseInterceptors(XmlInterceptor)`.
- The handler stub calls `this.buckets.listBuckets(req)` and returns the POJO with `__root: 'ListAllMyBucketsResult'`.

## Acceptance criteria
- [ ] `@Get('/')` route exists on `ServiceController`.
- [ ] Module declares the controller before bucket/object controllers.

## Test obligations
- Unit: covered by [TEST-0100]
- E2E: covered by [TEST-0111]
- Conformance: covered by [TEST-0112]

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.1 (line 1084), §2.8.1 (lines 2495–2499)
