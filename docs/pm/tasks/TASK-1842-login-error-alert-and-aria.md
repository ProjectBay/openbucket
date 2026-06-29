---
id: TASK-1842
title: Surface login errors via hlm-alert + field aria-invalid/aria-describedby
story: STORY-0608
status: done
type: implementation
size: S
---

## Description
Replace the raw `<p class="text-destructive">` error in `login.component.ts` with an accessible `hlm-alert variant="destructive"`, and associate the error with the form fields via `aria-invalid`/`aria-describedby` so screen readers announce the failure. Also push the failure through the shared `StatusAnnouncer` live region (from STORY-0600) so it is announced even though the alert appears after submit.

## Files to create / modify
- `apps/openbucket-frontend/src/app/auth/login.component.ts` — modify (error rendering + aria wiring + announcer call in `onSubmit` catch)

## Implementation notes
- Import `HlmAlertImports` from `@openbucket/spartan-ui/alert` (`HlmAlert` carries `host: { role: 'alert' }` and a `variant: 'default' | 'destructive'` input; also `HlmAlertTitle`/`HlmAlertDescription`/`HlmAlertIcon`). Render the alert only when `error()` is set:
  - `<div hlmAlert variant="destructive" id="login-error">` with an `[hlmAlertDescription]` of `{{ error() }}` and a leading destructive icon via `[hlmAlertIcon]` (e.g. `lucideTriangleAlert` from `@ng-icons/lucide`).
- On the username + password inputs set `[attr.aria-invalid]="error() ? 'true' : null"` and `[attr.aria-describedby]="error() ? 'login-error' : null"` so the alert is the description target.
- In `onSubmit`'s catch branch, after `this.error.set(this.messageFor(e))`, call the shared `StatusAnnouncer.announce(this.error()!, 'assertive')` (inject `StatusAnnouncer` from `shared/ui/status-announcer.service`, TASK-1803) so the failure is announced via the CDK `LiveAnnouncer` live region. Keep the existing `busy`/`error` signal flow otherwise unchanged.
- Do not introduce a second toaster; the destructive `hlmAlert` (role="alert") plus the announcer is the surface here.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] On a failed login the error renders inside `hlmAlert variant="destructive"` (role="alert"), not a bare `<p>`.
- [ ] The username/password inputs expose `aria-invalid="true"` and `aria-describedby="login-error"` while an error is present, and neither attribute when clear.
- [ ] The mapped error string is announced via `StatusAnnouncer` (manual: NVDA/VoiceOver reads it on submit).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0608] (wrong-credentials path + screen-reader announcement).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1841], [STORY-0600]

## References
- UX review 2026-06-22 (a11y F5 — error not in a live/role=alert region; design S4).
- `libs/ui/spartan/alert` (`@openbucket/spartan-ui/alert`, `HlmAlertImports`, `variant="destructive"`), `apps/openbucket-frontend/src/app/shared/ui/status-announcer.service.ts` (`StatusAnnouncer`, STORY-0600), `@ng-icons/lucide` (`lucideTriangleAlert`).
- Interfaces consumed: `StatusAnnouncer` (STORY-0600).
