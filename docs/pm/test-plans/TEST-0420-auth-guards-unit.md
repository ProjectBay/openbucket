---
id: TEST-0420
title: Auth guards unit spec
covers: [STORY-0415, TASK-1244, TASK-1245]
status: backlog
level: unit
---

## Goal
Verify `authGuard`, `unauthGuard`, `mustNotRotateGuard` return the right `true | UrlTree`.

## Setup
- `TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: stub }, { provide: Router, useValue: routerStub }] })`.
- `routerStub.createUrlTree` returns an identifiable sentinel per path.

## Cases
1. `authGuard` when `isAuthenticated() === true` → returns `true`.
2. `authGuard` when `isAuthenticated() === false` → returns `router.createUrlTree(['/login'])`.
3. `unauthGuard` when `isAuthenticated() === true` → returns `router.createUrlTree(['/buckets'])`.
4. `unauthGuard` when `isAuthenticated() === false` → returns `true`.
5. `mustNotRotateGuard` when `mustChangePassword() === true` → returns `router.createUrlTree(['/force-rotate'])`.
6. `mustNotRotateGuard` when `mustChangePassword() === false` → returns `true`.

## Tooling
- Framework: jest + Angular `TestBed`
- Runner: `nx test frontend --testPathPattern=auth.guard.spec.ts`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.11 (lines 7887–7911)
