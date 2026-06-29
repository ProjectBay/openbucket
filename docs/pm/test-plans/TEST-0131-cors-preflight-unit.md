---
id: TEST-0131
title: CORS preflight unit
covers: [STORY-0117, TASK-0359, TASK-0360, TASK-0361]
status: done
level: unit
---

## Goal
Verify `CorsController.preflight` rule-matching, error paths, and header emission per §2.9, plus `globMatch`/`matchOrigin`/`matchHeader` semantics.

## Setup
- Jest. Mock `BucketService.find(bucket)` returning either `undefined`, a row without CORS config, or a row with one or more `CORSRule`s.

## Cases
1. `globMatch('*', 'anything')` → true.
2. `globMatch('https://*.example.com', 'https://app.example.com')` → true.
3. `globMatch('https://example.com', 'https://other.com')` → false.
4. `matchHeader(['Content-Type'], 'content-type')` → true (case-insensitive).
5. OPTIONS without `Origin` and `Access-Control-Request-Method` → 200 with `Allow: GET, HEAD, PUT, POST, DELETE, OPTIONS` and no CORS headers.
6. OPTIONS with CORS headers but bucket not found → throws `NoSuchBucketError`.
7. OPTIONS with bucket lacking config → throws `NoSuchCORSConfigurationError('CORSResponse: CORS is not enabled for this bucket.')`.
8. OPTIONS where no rule matches → throws `AccessDeniedError('CORSResponse: This CORS request is not allowed.')`.
9. OPTIONS where a rule with `allowedOrigins: ['*']` matches → `Access-Control-Allow-Origin: *`.
10. OPTIONS where a non-`*` origin matches → `Access-Control-Allow-Origin: <literal origin>` and `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.
11. Rule with `maxAgeSeconds=3000` → `Access-Control-Max-Age: 3000`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=cors`

## Pass criteria
- [ ] All eleven cases pass.

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2585–2685)
