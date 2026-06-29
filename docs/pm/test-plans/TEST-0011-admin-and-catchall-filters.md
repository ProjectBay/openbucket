---
id: TEST-0011
title: Admin filter, catch-all filter, and Zod pipe wiring
covers: [STORY-0010, TASK-0025, TASK-0026, TASK-0027]
status: done
level: unit
---

## Goal
Verify `AdminExceptionFilter` produces the documented JSON shapes for `ZodValidationException`, `HttpException`, and unknown errors; `CatchAllExceptionFilter` returns a bare 500; and `ZodValidationPipe` is re-exported correctly.

## Setup
- Construct an `ArgumentsHost` stub with `req.openbucket = { kind: 'admin', requestId: 'rid-1' }`.

## Cases
1. Given `kind === 's3'`, when `AdminExceptionFilter.catch` runs, then it re-throws (does not write `res`).
2. Given `ZodValidationException` (from `nestjs-zod`) with two issues, when the filter runs, then status 400 and body `{ error: 'ValidationFailed', message: 'Request payload failed validation.', issues: [<two>], requestId: 'rid-1' }`.
3. Given `new HttpException({ error: 'NotFound', message: 'bucket not found' }, 404)`, when the filter runs, then status 404 and body `{ error: 'NotFound', message: 'bucket not found', requestId: 'rid-1' }`.
4. Given `new HttpException('plain', 418)`, when the filter runs, then status 418 and body `{ error: 'plain', requestId: 'rid-1' }`.
5. Given a generic `Error`, when the filter runs, then status 500, body `{ error: 'InternalError', message: 'An unexpected error occurred.', requestId: 'rid-1' }`, and `Logger.error` is invoked with `{ err, requestId }`.
6. Given `CatchAllExceptionFilter`, when any exception is thrown for a request whose `kind` is undefined (theoretical), then it logs and returns status 500 with no body.
7. Given `import { ZodValidationPipe } from '<...>/pipes/zod-validation.pipe'`, then the imported class is identical to the one exported from `nestjs-zod`.

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=admin-exception.filter.spec`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §1.6.2 (lines 649–705)
