---
id: TEST-0133
title: CORS preflight conformance (curl / browser fetch)
covers: [STORY-0117]
status: backlog
level: conformance
---

## Goal
Verify CORS preflight from a real client perspective using curl (and optionally a browser-fetch harness).

## Setup
- OpenBucket container.
- Pre-configure `b` with a CORS rule allowing `https://example.com` GET/PUT.

## Cases
1. `curl -X OPTIONS http://localhost:9000/b/k -H "Origin: https://example.com" -H "Access-Control-Request-Method: GET" -i` → 200 with `Access-Control-Allow-Origin: https://example.com` and `Vary` set.
2. Same as above with disallowed origin → 403 `CORSResponse: This CORS request is not allowed.`.
3. Browser fetch from a small static page hosted at `https://example.com` succeeds in a Chromium headless run (Playwright optional).

## Client matrix
| Client | Version | Notes |
|---|---|---|
| curl | 7.x+ | required |
| Playwright (Chromium) | latest | optional |

## Tooling
- Framework: curl + optional Playwright
- Runner: `nx run conformance:run --suite=cors-preflight`

## Pass criteria
- [ ] curl cases pass.
- [ ] Playwright case passes if run.

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2585–2685)
