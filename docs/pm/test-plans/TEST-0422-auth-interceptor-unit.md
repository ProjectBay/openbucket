---
id: TEST-0422
title: authInterceptor unit spec (single-retry semantics)
covers: [STORY-0416, TASK-1248, TASK-1249]
status: backlog
level: unit
---

## Goal
Verify the interceptor's single-retry-on-401 contract and bearer-attachment rules.

## Setup
- `HttpTestingController` to intercept requests.
- Stub `AuthService` with controllable `getAccessToken()`, `refresh()`, `logout()`.

## Cases
1. Request to `/api/admin/buckets` with token in `AuthService` → outgoing request has `Authorization: Bearer <token>` and `withCredentials: true`.
2. Request to `/api/admin/auth/login` → no `Authorization` header is attached, but `withCredentials: true` is set.
3. Request to `/api/admin/auth/refresh` → no `Authorization`, but `withCredentials: true`.
4. Non-401 error (e.g. 500) → error propagates; `refresh()` is NOT called.
5. 401 response → `refresh()` is called once; on `true` the original request is retried with the new token; on success the caller observes the retried response.
6. 401 then `refresh()` returns `false` → `auth.logout()` is called once; original 401 is rethrown.
7. The retried request that also returns 401 does NOT trigger another `refresh()` call (one-shot).

## Tooling
- Framework: jest + `HttpTestingController`
- Runner: `nx test frontend --testPathPattern=auth.interceptor.spec.ts`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §5.12 (lines 8019–8065)
