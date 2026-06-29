---
id: STORY-0006
title: Implement UUIDv7 request-id middleware
epic: EPIC-01
status: done
size: XS
risk: low
---

## User story
As an operator, I want every request to receive a sortable UUIDv7 request id that is reflected in both `X-Request-Id` and `X-Amz-Request-Id` response headers and in every Pino log line, so that log triage and S3-SDK error messages can correlate back to the originating request.

## Description
Implement `apps/backend/src/common/middleware/request-id.middleware.ts` per §1.5. Honour an upstream `X-Request-Id` if it matches `^[0-9a-f-]{36}$/i`; otherwise mint a UUIDv7 via `import { v7 as uuidv7 } from 'uuid'`. Initialize `req.openbucket = { requestId, kind: 's3', receivedAt: 0 }` (the default `kind` is overwritten by the classifier). Set both `X-Request-Id` and `X-Amz-Request-Id` response headers to the request id.

## Acceptance criteria
- [ ] A request with no `X-Request-Id` header receives a fresh UUIDv7 (timestamp prefix recoverable).
- [ ] A request with a syntactically valid `X-Request-Id` reuses that value.
- [ ] Response includes both `X-Request-Id` and `X-Amz-Request-Id` headers equal to `req.openbucket.requestId`.
- [ ] `req.openbucket` is initialized as `{ requestId, kind: 's3', receivedAt: 0 }` before `next()`.

## Tasks
- [TASK-0013] Implement RequestIdMiddleware
- [TASK-0014] Add uuid v7 dependency and import path

## Test plan
- [TEST-0006] Request-id assignment and propagation (unit)

## Dependencies
- Blocks: [STORY-0004], [STORY-0007]
- Blocked by: [STORY-0005]

## References
- `docs/WHITEPAPER.md` §1.5 (lines 491–521)
- Interfaces consumed: `OpenBucketRequestContext` (STORY-0005)
- Interfaces produced: `RequestIdMiddleware` (consumed by STORY-0004, STORY-0008)
