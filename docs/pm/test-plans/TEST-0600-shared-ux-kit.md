---
id: TEST-0600
title: Shared UX kit — toasts, confirm dialog, copy-button, announcer
covers: [STORY-0600, TASK-1800, TASK-1801, TASK-1802, TASK-1803]
status: done
level: unit
---

## Goal
Verify the shared UX primitives behave correctly and are accessible: toasts fire via `notify`, the confirm dialog gates resolution (incl. type-to-confirm), the copy-button copies + gives feedback, and the announcer/toaster expose live regions.

## Setup
- Frontend unit harness: `jest-preset-angular` (run on Node 23 for the frontend — opposite of the backend's Node 20). If the frontend jest project is not yet wired, treat the unit cases as build-verified and run the behavioral cases manually in `nx serve openbucket-frontend`.
- A screen reader (NVDA on Windows / VoiceOver) for the a11y cases.

## Cases
1. Given `notify.success('saved')`, when called, then `ngx-sonner` `toast.success` is invoked and a toast appears.
2. Given `notify.promise(p, {...})`, when `p` resolves/rejects, then the toast transitions loading→success/error.
3. Given a `ConfirmDialogComponent` with `confirmPhrase='my-bucket'`, when opened, then the Action button is disabled until the input equals `my-bucket`; clicking Action resolves `true`, Cancel/Escape resolves `false`.
4. Given `destructive=true`, then the Action renders `variant="destructive"` and a warning icon; focus moves into the dialog on open and returns to the trigger on close.
5. Given a `CopyButtonComponent value="abc"`, when clicked, then `navigator.clipboard.writeText('abc')` is called, a "Copied" toast fires, and the icon swaps to check then back; the button has `aria-label`.
6. Given `StatusAnnouncer.announce('done', 'assertive')`, then CDK `LiveAnnouncer` announces it; the sonner toaster region is `aria-live`.

## Tooling
- Framework: jest (`@testing-library/angular` optional) + manual screen-reader.
- Runner: `nx test openbucket-frontend --testPathPatterns=shared` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Cases 1–6 verified (unit where the harness runs; otherwise manual).

## References
- UX review 2026-06-22 (interaction F1/F2/F7; a11y A11Y-3).
- STORY-0600 and TASK-1800..1803.
