---
id: TEST-0003
title: Body parsing scope (admin only)
covers: [STORY-0003, TASK-0007]
status: done
level: unit
---

## Goal
Verify that `configureBodyParsers` mounts JSON and url-encoded parsers exclusively on `/api/admin/*` and leaves all other routes as raw streams.

## Setup
- Express instance constructed in the test; `configureBodyParsers` applied; minimal route handlers attached for both `/api/admin/echo` and `/s3-echo`.

## Cases
1. Given `POST /api/admin/echo` with `Content-Type: application/json` and body `{"a":1}`, when handled, then `req.body.a === 1`.
2. Given `POST /api/admin/echo` with a 2 MiB JSON body, when handled, then Express rejects with status 413 (`entity too large`).
3. Given `POST /s3-echo` with `Content-Type: application/octet-stream` and a 1 MiB body, when handled, then `req.body === undefined` and the body is consumable from `req` as a readable stream (chunks sum to 1 MiB).
4. Given `POST /api/admin/form` with `application/x-www-form-urlencoded` body `k=v`, when handled, then `req.body.k === 'v'`.

## Tooling
- Framework: jest + supertest
- Runner: `nx test openbucket-backend --testPathPattern=body-parser.spec`

## Pass criteria
- [ ] All four cases pass.
- [ ] No body parser fires on `/s3-echo`.

## References
- `docs/WHITEPAPER.md` §1.2.2 (lines 199–224)
