---
id: STORY-0009
title: Implement S3ExceptionFilter scaffold (XML, request-id, kind gate)
epic: EPIC-01
status: done
size: S
risk: medium
---

## User story
As an S3 client, I want errors on S3-classified routes to return an XML body with `<Error><Code><Message><Resource><RequestId>` and `Content-Type: application/xml`, so that standard S3 SDKs can parse the error and surface the request id for correlation.

## Description
Implement `apps/backend/src/common/filters/s3-exception.filter.ts` as scaffolding per §1.6.1. The full error-code table and canonical XML body belong to EPIC-02 (the S3 agent). The filter must (a) re-throw if `req.openbucket?.kind !== 's3'`, (b) map `S3Error` (a thin placeholder type) and `HttpException` to `{ status, code, message }` via `mapToS3Shape`, default to 500 `InternalError`, (c) emit `Content-Type: application/xml` and `x-amz-request-id` headers, (d) include a `<Resource>` element built from `/{bucket}/{key}`, (e) log 5xx via `Logger.error`, (f) provide `escapeXml` for the five XML entities.

## Acceptance criteria
- [ ] Filter is `@Catch()` (catch-all by design).
- [ ] Non-S3 requests cause the filter to re-throw (admin filter then takes over).
- [ ] Response has `Content-Type: application/xml` and the request id in `x-amz-request-id`.
- [ ] XML body contains `<Code>`, `<Message>`, `<Resource>`, `<RequestId>` and is XML-escaped.
- [ ] 5xx responses emit a `Logger.error` line with `{ err, requestId, code }`.
- [ ] `S3Error` import path matches `../../s3/errors/s3-error` so EPIC-02 owns the concrete class.

## Tasks
- [TASK-0022] Implement S3ExceptionFilter class
- [TASK-0023] Implement mapToS3Shape and escapeXml helpers
- [TASK-0024] Add S3Error placeholder import path

## Test plan
- [TEST-0010] S3ExceptionFilter scaffold (unit)

## Dependencies
- Blocks: [STORY-0008]
- Blocked by: [STORY-0005], [STORY-0007]

## References
- `docs/WHITEPAPER.md` §1.6.1 (lines 570–647)
- Interfaces consumed: `OpenBucketRequestContext` (STORY-0005), `S3Error` (owned by EPIC-02)
- Interfaces produced: `S3ExceptionFilter` (consumed by STORY-0008)
