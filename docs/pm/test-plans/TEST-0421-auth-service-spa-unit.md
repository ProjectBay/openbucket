---
id: TEST-0421
title: SPA AuthService unit spec
covers: [STORY-0416, TASK-1247]
status: backlog
level: unit
---

## Goal
Verify `AuthService` signal updates, `withCredentials` usage, navigation targets, and absence of `localStorage` writes.

## Setup
- `HttpTestingController` from `@angular/common/http/testing`.
- Spy on `Router.navigate`.
- Stub `localStorage`/`sessionStorage` (the test fails if any `setItem` is called).

## Cases
1. `login('admin', 'p')` issues `POST /api/admin/auth/login` with `withCredentials: true`; on response sets `accessToken`, calls `/me`, then `router.navigate(['/buckets'])`.
2. `login` when `/me` returns `mustChangePassword: true` → `router.navigate(['/force-rotate'])`.
3. `refresh()` returns `true` on 200; signals updated; `me` is loaded if not present.
4. `refresh()` returns `false` on 401; `accessToken` and `me` cleared.
5. `logout()` posts to `/api/admin/auth/logout` and clears both signals even when the HTTP call fails (try/finally).
6. No `localStorage.setItem` or `sessionStorage.setItem` is called at any point.
7. `isAuthenticated()` is `true` iff `accessToken` non-null; `mustChangePassword()` reflects `me`.

## Tooling
- Framework: jest + `HttpTestingController`
- Runner: `nx test frontend --testPathPattern=auth.service.spec.ts`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §5.12 (lines 7928–8014)
