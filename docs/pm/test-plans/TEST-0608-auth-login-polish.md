---
id: TEST-0608
title: Auth & login polish — login success/failure, force-rotate, a11y
covers: [STORY-0608, TASK-1841, TASK-1842, TASK-1843, TASK-1844]
status: done
level: e2e
---

## Goal
Verify the rebuilt login and the newly-implemented force-rotate screens work end-to-end and are accessible: valid credentials sign in, wrong credentials surface a mapped destructive alert (announced + `aria-invalid`/`aria-describedby`), a must-change-password user lands on a working force-rotate screen and proceeds, and both screens are keyboard- and screen-reader-navigable in en/de.

## Setup
- Frontend on Node 23 (the frontend toolchain; backend runs on Node 20 — opposite requirements). Backend admin API reachable for the e2e/manual pass (login, `/me`, change-password endpoints).
- A screen reader (NVDA on Windows / VoiceOver) for the a11y cases; a seeded admin whose `/me` returns `mustChangePassword: true` for the rotation case.
- If the frontend jest harness is not wired, treat the build/lint anchors as the gate and run the behavioral cases manually in `nx serve openbucket-frontend`.

## Cases
1. Given valid admin credentials, when submitting the login form, then `AuthService.login` succeeds and the app navigates to `/buckets` (or `/force-rotate` when must-rotate); the form uses `hlmCard`/`hlm-field`/`hlmInput`/`hlmBtn` and shows the `ob-brand` mark.
2. Given wrong credentials, when submitting, then an `hlmAlert variant="destructive"` (role="alert") shows the `messageFor`-mapped string, the inputs carry `aria-invalid="true"` + `aria-describedby="login-error"`, and `StatusAnnouncer` announces the error.
3. Given `status === 0` (server unreachable), then the alert shows the "cannot reach the server" message; given 400/401, the "invalid credentials" message.
4. Given a must-change-password user routed to `/force-rotate`, when the screen loads, then it renders the change-password card (not "Coming soon") with current/new/confirm fields; new ≠ confirm disables submit and shows an inline error.
5. Given a valid rotation, when submitting, then `AuthService.changePassword` is called and the app navigates into the console (`/buckets`); the user is no longer stranded.
6. Given keyboard-only navigation, then tab order reaches every field + submit, focus is visible, and Enter submits; with a screen reader, labels and the error alert are announced.
7. Given locale `de`, then login + force-rotate render the German `auth.*` strings.

## Tooling
- Framework: Playwright/manual e2e + manual screen-reader (NVDA/VoiceOver); jest (`@testing-library/angular`) optional if the frontend harness is wired.
- Runner: `nx e2e openbucket-frontend-e2e` (if present) / manual `nx serve openbucket-frontend`; `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–7 verified (e2e where harnessed; otherwise manual).

## References
- UX review 2026-06-22 (design S4; interaction F10; a11y F5).
- STORY-0608 and TASK-1841..1844.
