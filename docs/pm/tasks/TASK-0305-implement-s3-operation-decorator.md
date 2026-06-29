---
id: TASK-0305
title: Implement @S3Operation decorator and operation dispatcher metadata
story: STORY-0100
status: done
type: implementation
size: S
---

## Description
Build the `@S3Operation('<Name>', {...})` decorator that tags a controller dispatch branch with the AWS operation name. The decorator sets `req.openbucket.operation` so the `XmlInterceptor`, logger, and exception filter can identify the operation by its canonical AWS name.

## Files to create / modify
- `apps/backend/src/s3/routing/operation.decorator.ts` — modify (implement)

## Implementation notes
- Per §2.1 line 1078 and §2.8 lines 2491–2493: "the `@S3Operation` decorator on the matching dispatch branch sets `req.openbucket.operation = '<Name>'`".
- The decorator may be implemented as a NestJS metadata decorator (`SetMetadata('s3-operation', name)`) consumed by a method-level interceptor that mutates `req.openbucket.operation` before the handler runs.
- Operation names must match the AWS API verbatim (the right-hand column of the §2.8 tables — `ListBuckets`, `CreateBucket`, `PutObject`, `UploadPart`, `CompleteMultipartUpload`, etc.).

## Acceptance criteria
- [ ] Decorator usable as `@S3Operation('PutObject')` on a handler branch.
- [ ] `req.openbucket.operation` is set before the `XmlInterceptor` checks `XML_REQUEST_OPS`.
- [ ] Unit test confirms metadata propagation.

## Test obligations
- Unit: covered by [TEST-0100]
- E2E: N/A — consumed by other tests
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300], [TASK-0306]

## References
- `docs/WHITEPAPER.md` §2.1 (lines 1076–1078), §2.8 (lines 2487–2493)
