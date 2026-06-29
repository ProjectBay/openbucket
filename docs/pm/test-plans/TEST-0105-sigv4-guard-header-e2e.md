---
id: TEST-0105
title: SigV4Guard header-based e2e
covers: [STORY-0103, TASK-0314, TASK-0318]
status: backlog
level: e2e
---

## Goal
Verify that `SigV4Guard` accepts properly-signed header-based requests and rejects malformed/mismatched ones with the right XML body and HTTP status.

## Setup
- Boot the backend with a fixture access key.
- supertest + aws4 to produce signed requests.

## Cases
1. Given a `GET /` signed correctly, when sent, then 200 and the body lists buckets.
2. Given a `GET /` signed with a wrong secret, when sent, then 403 `<Code>SignatureDoesNotMatch</Code>`.
3. Given a `GET /` with no `Authorization` header, when sent, then 403 `<Code>AccessDenied</Code>`.
4. Given a `GET /` with `X-Amz-Date` set 20 minutes in the past, when sent, then 403 `<Code>RequestTimeTooSkewed</Code>` and `<ServerTime>`/`<RequestTime>` extras present.
5. Given a `GET /` signed for an unknown access key id, when sent, then 403 `<Code>SignatureDoesNotMatch</Code>` (no leakage of unknown-key).

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=sigv4-guard`

## Pass criteria
- [ ] All five cases pass with the documented XML bodies.

## References
- `docs/WHITEPAPER.md` §2.4 (lines 1576–1982)
