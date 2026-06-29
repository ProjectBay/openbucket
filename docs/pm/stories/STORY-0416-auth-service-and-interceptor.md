---
id: STORY-0416
title: Implement AuthService and single-retry refresh interceptor
epic: EPIC-05
status: done
size: M
risk: high
---

## User story
As an admin user, I want the SPA to keep the access token in memory only and silently refresh once on a 401, so that I stay logged in across the 15-minute access-token lifetime without ever persisting credentials to `localStorage`.

## Description
Implement `apps/frontend/src/app/auth/auth.service.ts` per §5.12. Two private signals (`accessToken`, `me`) drive `isAuthenticated`, `mustChangePassword`, `username` computed signals. Public methods: `login(username, password)`, `refresh()`, `logout()`, `loadMe()`, `getAccessToken()`. Every HTTP call to `/api/admin/auth/*` uses `withCredentials: true`. Login navigates to `/force-rotate` if `mustChangePassword`, else `/buckets`. On `refresh` failure both signals clear.

Implement `apps/frontend/src/app/auth/auth.interceptor.ts` per §5.12. `AUTH_PATHS = ['/api/admin/auth/login', '/api/admin/auth/refresh']` skip bearer attachment (but still send `withCredentials`). Every other request attaches `Authorization: Bearer <token>` and `withCredentials: true`. On HTTP 401, call `auth.refresh()` exactly once, retry the original request with the new token, and on second failure call `auth.logout()` and rethrow.

## Acceptance criteria
- [x] `accessToken` and `me` are private signals; only computed read accessors are exported.
- [x] `AuthService.login` posts `{ username, password }` to `/api/admin/auth/login` with `withCredentials: true`, sets `accessToken`, loads me, then navigates based on `mustChangePassword`.
- [x] `AuthService.refresh` posts to `/api/admin/auth/refresh` and returns `true` on success / `false` on failure; on failure both signals are cleared.
- [x] `authInterceptor` does **not** attach a bearer to URLs matching `AUTH_PATHS` (login / refresh).
- [x] `authInterceptor` attempts refresh at most once per request; a second 401 triggers `auth.logout()` and rethrows.
- [x] All non-public requests are sent with `withCredentials: true`.
- [x] Access token is never written to `localStorage` or `sessionStorage`.

## Tasks
- [TASK-1247] Implement `AuthService` (signals + login/refresh/logout/loadMe)
- [TASK-1248] Implement `authInterceptor` with single-retry refresh
- [TASK-1249] Implement `attachToken` helper

## Test plan
- [TEST-0421] AuthService unit spec
- [TEST-0422] authInterceptor unit spec (single-retry semantics)

## Dependencies
- Blocks: [STORY-0415], [STORY-0417], [STORY-0418], [STORY-0419]
- Blocked by: [STORY-0403], [STORY-0404], [STORY-0405], [STORY-0406], [STORY-0414]

## References
- `docs/WHITEPAPER.md` §5.12 (lines 7928–8068)
- Interfaces produced: `AuthService`, `authInterceptor`
- Interfaces consumed: backend admin auth endpoints (STORY-0403/0404/0405/0406)
