---
id: TEST-0010
title: S3ExceptionFilter scaffold behavior
covers: [STORY-0009, TASK-0022, TASK-0023, TASK-0024]
status: done
level: unit
---

## Goal
Verify the S3 exception filter only handles S3-classified requests, emits the documented XML body, and logs 5xx through `Logger.error`.

## Setup
- Construct an `ArgumentsHost` stub with `req.openbucket = { kind, requestId, bucket, key }`. Instantiate `S3ExceptionFilter` directly.

## Cases
1. Given `req.openbucket.kind === 'admin'`, when `catch(new Error('x'), host)` runs, then the filter re-throws and does not write to `res`.
2. Given `kind === 's3'` and an `S3Error('NoSuchBucket', 404, 'msg')`, when the filter runs, then status 404, `Content-Type: application/xml`, `x-amz-request-id` equals the request id, and the body contains `<Code>NoSuchBucket</Code><Message>msg</Message>`.
3. Given `kind === 's3'` and a generic `Error`, when the filter runs, then status 500, body contains `<Code>InternalError</Code><Message>We encountered an internal error.</Message>`, and `Logger.error` is called with `{ err, requestId, code }`.
4. Given a key containing `<`, `&`, `>`, `"`, `'`, when the XML body is rendered, then those entities are escaped per `escapeXml`.
5. Given `kind === 's3'` and an `HttpException('boom', 418)`, when the filter runs, then status 418 with `<Code>InternalError</Code><Message>boom</Message>`.

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=s3-exception.filter.spec`

## Pass criteria
- [ ] All five cases pass.
- [ ] XML output begins with `<?xml version="1.0" encoding="UTF-8"?>\n<Error>`.

## References
- `docs/WHITEPAPER.md` §1.6.1 (lines 570–647)
