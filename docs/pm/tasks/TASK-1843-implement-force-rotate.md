---
id: TASK-1843
title: Implement force-rotate.component.ts (must-change-password screen)
story: STORY-0608
status: done
type: implementation
size: M
---

## Description
Replace the `force-rotate.component.ts` "Coming soon" placeholder with a real change-password screen, styled identically to the rebuilt login card. `AuthService.login` already routes users whose `/me` returns `mustChangePassword: true` to `/force-rotate`, so this is currently a dead end for real must-rotate users. The screen collects current + new + confirm passwords, calls the change-password endpoint, and on success navigates the user into the console.

## Files to create / modify
- `apps/openbucket-frontend/src/app/auth/force-rotate.component.ts` — replace placeholder (selector `ob-force-rotate`, standalone)
- `apps/openbucket-frontend/src/app/auth/auth.service.ts` — modify (add a `changePassword(...)` method if one is not already present)

## Implementation notes
- Reuse the login card chrome from TASK-1841: `HlmCardImports`, `HlmFieldImports`, `HlmInput`, `HlmLabel`, `HlmButton`, `<ob-brand />`, and the destructive `hlmAlert` + aria pattern from TASK-1842. Title "Change your password", description explaining it is required before continuing.
- Fields (all `type="password"`, `FormsModule` `[(ngModel)]`): current password, new password, confirm new password. Disable submit while `busy()` or while new ≠ confirm; show an inline `hlmAlert`/field error when they differ.
- The backend contract is `ChangePasswordDto` (`libs/api-client/src/lib/model/change-password-dto.ts`) on the admin auth API. Add `AuthService.changePassword(dto)` that posts to the change-password endpoint with `{ withCredentials: true }` (mirror the existing `login`/`refresh` calls which use `firstValueFrom(this.http.post<…>('/api/admin/auth/…', body, { withCredentials: true }))`). After a successful change, re-`loadMe()` (or clear `mustChangePassword`) and `router.navigate(['/buckets'])` — matching `AuthService.login`'s post-success navigation.
- Map errors with the same shape as `login.component.ts.messageFor` (401/400 → invalid current password; 0 → cannot reach server; else generic), surfaced via the destructive `hlmAlert` + `StatusAnnouncer.announce(...,'assertive')`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `force-rotate.component.ts` no longer renders "Coming soon"; it renders the card with three password fields styled like the login card.
- [ ] Submitting a valid rotation calls `AuthService.changePassword`, then navigates to `/buckets` (or the post-login target); a must-rotate user is no longer stranded.
- [ ] New ≠ confirm disables submit and shows an inline error; a failed rotation shows the mapped `hlmAlert` error and is announced.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0608] (must-rotate user lands on a working screen and proceeds).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1841], [TASK-1842]

## References
- UX review 2026-06-22 (interaction F10 — dead "Coming soon" screen on a live route).
- `apps/openbucket-frontend/src/app/auth/{force-rotate.component.ts,auth.service.ts}` (existing `login`/`refresh`/`loadMe`, `mustChangePassword` computed, `/force-rotate` routing), `libs/api-client/src/lib/model/change-password-dto.ts` (`ChangePasswordDto`), `libs/ui/spartan/{card,field,input,label,button,alert}`.
- Interfaces consumed: `BrandComponent` (STORY-0601), `StatusAnnouncer` (STORY-0600), `ChangePasswordDto` (`@openbucket/api-client`).
