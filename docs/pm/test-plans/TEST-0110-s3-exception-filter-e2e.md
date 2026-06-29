---
id: TEST-0110
title: S3 exception filter e2e
covers: [STORY-0106, TASK-0321]
status: backlog
level: e2e
---

## Goal
End-to-end verify that thrown `S3Error` instances surface as canonical AWS XML envelopes with the right status, headers, and HEAD-no-body behaviour.

## Setup
- Boot the backend, register a test endpoint that throws each error variety on demand.

## Cases
1. Given a route that throws `NoSuchKeyError('photos/2026/sunset.jpg')`, when GET, then 404 body matches §2.7 sample (lines 2473–2483).
2. Given the same route hit with HEAD, when HEAD, then 404 status but body length 0.
3. Given a 5xx-throwing route, when called, then 500 `<Code>InternalError</Code>` and a logged error (`logger.error`).
4. Given a route that throws a NestJS 405, when called, then `<Code>MethodNotAllowed</Code>`.
5. Given a route that already started streaming (`res.headersSent === true`) then throws, when triggered, then `res.destroy(err)` is called and no XML body is appended.
6. Every response sets `x-amz-request-id` equal to `req.openbucket.requestId`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=exception-filter`

## Pass criteria
- [ ] All six cases pass with verbatim XML bodies and headers.

## References
- `docs/WHITEPAPER.md` §2.7 (lines 2360–2483)
