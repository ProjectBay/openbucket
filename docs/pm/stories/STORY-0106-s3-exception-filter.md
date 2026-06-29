---
id: STORY-0106
title: S3 XML exception filter
epic: EPIC-02
status: done
size: S
risk: medium
---

## User story
As an S3 client, I want every thrown `S3Error` (and every uncaught exception) to be rendered as the canonical AWS XML error envelope with the right HTTP status, `Resource`, `RequestId`, and `HostId`, so that my SDK can parse and react to failures.

## Description
Realize §2.7 of the white paper. Implement the `S3ExceptionFilter` body: normalize anything that is not an `S3Error` to `InternalError` (mapping Nest `HttpException` 405→`MethodNotAllowed`, 404→`NoSuchKey`); compute `resource` from `req.openbucket`; log 5xx errors at `error` level and 4xx at `debug`; emit `Content-Type: application/xml`, `x-amz-request-id`, `Content-Length`; abort the response (no body) when the handler already started streaming; honour AWS parity by writing **no body for HEAD** even on error. The scaffolding (registering on the S3 controller tree, excluding the admin tree) is owned by EPIC-01; this Story provides the filter body.

## Acceptance criteria
- [ ] Filter renders a body matching §2.7 sample (lines 2473–2483).
- [ ] `HEAD` requests receive headers + status but no body.
- [ ] When `res.headersSent === true`, filter calls `res.destroy(err)` and returns.
- [ ] Non-`S3Error` exceptions are normalized to `InternalError` (5xx logged via `Logger.error`).
- [ ] `x-amz-request-id` header equals `req.openbucket.requestId` (or `'unknown'`).

## Tasks
- [TASK-0321] Implement S3ExceptionFilter body

## Test plan
- [TEST-0110] S3 exception filter e2e

## Dependencies
- Blocks: [STORY-0100]
- Blocked by: [STORY-0105], [EPIC-01]

## References
- `docs/WHITEPAPER.md` §2.7 (lines 2360–2483)
- Interfaces consumed: `S3Error`, `InternalError` (defined in STORY-0105), `req.openbucket` (defined in STORY-0100)
- Interfaces produced: `S3ExceptionFilter`
