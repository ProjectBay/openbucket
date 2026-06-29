---
id: TEST-0132
title: CORS preflight e2e
covers: [STORY-0117, TASK-0359, TASK-0361]
status: done
level: e2e
---

## Goal
End-to-end verify OPTIONS preflight against a running app — confirm controller ordering (CorsController before ObjectController) and verify the OPTIONS bypass of `SigV4Guard`.

## Setup
- Boot backend, configure CORS on a test bucket with a single rule allowing `https://example.com` GET.

## Cases
1. `OPTIONS /b/k` with `Origin: https://example.com` and `Access-Control-Request-Method: GET` and **no** Authorization → 200 with the documented CORS headers.
2. `OPTIONS /b/k` with `Origin` from a non-allowed origin → 403 `<Code>AccessDenied</Code>` and message `CORSResponse: This CORS request is not allowed.`.
3. `OPTIONS /b/k` against a bucket without CORS config → 404 `<Code>NoSuchCORSConfiguration</Code>`.
4. `OPTIONS /b/k` with no `Origin` → 200, `Allow` header set, no CORS headers.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=cors-preflight`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2585–2685)
