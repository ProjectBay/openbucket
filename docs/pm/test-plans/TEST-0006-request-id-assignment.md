---
id: TEST-0006
title: Request-id middleware assignment and propagation
covers: [STORY-0006, TASK-0013, TASK-0014]
status: done
level: unit
---

## Goal
Verify `RequestIdMiddleware` honours valid upstream `X-Request-Id`, mints a UUIDv7 otherwise, initializes `req.openbucket`, and sets both response headers.

## Setup
- Mount the middleware on a minimal Express stack with a single route returning `req.openbucket`.

## Cases
1. Given no `X-Request-Id` header, when the middleware runs, then `req.openbucket.requestId` matches the UUIDv7 regex and the response includes `X-Request-Id` and `X-Amz-Request-Id` equal to that value.
2. Given `X-Request-Id: 0190d9c1-7f32-7c0c-bea5-1f51d1c0b2c4`, when the middleware runs, then that value is reused.
3. Given `X-Request-Id: not-a-uuid`, when the middleware runs, then a fresh UUIDv7 is minted (incoming value discarded).
4. Given any of the above, then `req.openbucket.kind === 's3'` (the placeholder default) and `req.openbucket.receivedAt === 0` after the middleware (set later by the classifier).

## Tooling
- Framework: jest + supertest
- Runner: `nx test openbucket-backend --testPathPattern=request-id.middleware.spec`

## Pass criteria
- [ ] All four cases pass.
- [ ] UUIDv7 regex check matches `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.

## References
- `docs/WHITEPAPER.md` §1.5 (lines 491–521)
