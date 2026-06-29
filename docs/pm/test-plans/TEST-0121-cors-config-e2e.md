---
id: TEST-0121
title: CORS configuration e2e
covers: [STORY-0112, TASK-0352]
status: done
level: e2e
---

## Goal
End-to-end verify bucket CORS configuration round-trip.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `PUT /b?cors` with `<CORSConfiguration><CORSRule><AllowedOrigin>https://example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule></CORSConfiguration>` → 200; `GET /b?cors` returns the same.
2. `PUT /b?cors` with two rules → 200; `GET /b?cors` returns both rules (verifying `CORSRule` parsed as array).
3. `DELETE /b?cors` → 204; `GET /b?cors` → 404 `<Code>NoSuchCORSConfiguration</Code>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=cors-config`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2518–2520)
