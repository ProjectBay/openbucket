---
id: TASK-1245
title: Implement authGuard, unauthGuard, mustNotRotateGuard
story: STORY-0415
status: done
type: implementation
size: XS
---

## Description
Three `CanActivateFn` guards reading from `AuthService`.

## Files to create / modify
- `apps/frontend/src/app/auth/auth.guard.ts` — new

## Implementation notes
- Verbatim from §5.11 (lines 7887–7911):
  ```ts
  export const authGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.isAuthenticated()) return true;
    return router.createUrlTree(['/login']);
  };

  export const unauthGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.isAuthenticated() ? router.createUrlTree(['/buckets']) : true;
  };

  export const mustNotRotateGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.mustChangePassword() ? router.createUrlTree(['/force-rotate']) : true;
  };
  ```

## Acceptance criteria
- [ ] All three guards exported as `CanActivateFn`.
- [ ] Use `inject()` (no constructor — they are function guards).
- [ ] Redirects return `router.createUrlTree([...])`.

## Test obligations
- Unit: covered by [TEST-0420]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1247]

## References
- `docs/WHITEPAPER.md` §5.11 (lines 7887–7911)
