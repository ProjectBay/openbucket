---
id: STORY-0010
title: Implement AdminExceptionFilter, catch-all filter, and Zod validation pipe
epic: EPIC-01
status: done
size: S
risk: low
---

## User story
As an admin API client, I want validation errors and HTTP exceptions on admin routes to return JSON bodies that always include the request id, and unknown errors to surface as a sanitized 500, so that the admin SPA and tooling can reason about failure modes uniformly.

## Description
Implement `apps/backend/src/common/filters/admin-exception.filter.ts` per §1.6.2: gate on `req.openbucket?.kind === 'admin'`, map `ZodValidationException` to a 400 with `{ error: 'ValidationFailed', message, issues, requestId }`, map `HttpException` to its status with the response body merged with `{ requestId }`, default to 500 `InternalError`. Also implement `apps/backend/src/common/filters/catch-all.filter.ts` as a last-resort guard per §1.6.2 (one-line log + 500, no body) and re-export `ZodValidationPipe` from `nestjs-zod` in `apps/backend/src/common/pipes/zod-validation.pipe.ts` per §1.6.3.

## Acceptance criteria
- [ ] `AdminExceptionFilter` re-throws when `kind !== 'admin'`.
- [ ] `ZodValidationException` returns 400 with `issues` array and `requestId`.
- [ ] `HttpException` responses include `requestId` field.
- [ ] Unknown errors return 500 with `{ error: 'InternalError', message, requestId }` and log via `Logger.error`.
- [ ] `catch-all.filter.ts` is registered as the bottom filter and returns 500 with no body.
- [ ] `pipes/zod-validation.pipe.ts` re-exports `ZodValidationPipe` from `nestjs-zod`.

## Tasks
- [TASK-0025] Implement AdminExceptionFilter
- [TASK-0026] Implement CatchAllExceptionFilter
- [TASK-0027] Re-export ZodValidationPipe from nestjs-zod

## Test plan
- [TEST-0011] Admin / catch-all filters (unit)

## Dependencies
- Blocks: [STORY-0008]
- Blocked by: [STORY-0005], [STORY-0007]

## References
- `docs/WHITEPAPER.md` §1.6.2 (lines 649–700)
- `docs/WHITEPAPER.md` §1.6.3 (lines 702–705)
- Interfaces consumed: `OpenBucketRequestContext` (STORY-0005), `ZodValidationException` (`nestjs-zod`)
- Interfaces produced: `AdminExceptionFilter`, `CatchAllExceptionFilter`, `ZodValidationPipe` (all consumed by STORY-0008)
