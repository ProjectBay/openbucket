---
id: STORY-0608
title: Auth & login polish on the design system (login, force-rotate)
epic: EPIC-07
status: done
size: S
risk: medium
---

## User story
As an admin, I want a branded, design-system login and a working "you must change your password" screen, so the first impression is polished and must-rotate users don't hit a dead end.

## Description
`login.component.ts` does busy/error mapping well but uses raw `<input>`/`<button>` with no brand mark and no design-system controls. `force-rotate.component.ts` is a "Coming soon" placeholder even though `AuthService.login` actively routes `mustChangePassword` users to it — a dead screen for real users.

## Acceptance criteria
- [ ] Login uses `hlm-card` + `hlm-field`/`hlm-label`/`hlm-input` + `hlmBtn`; the `ob-brand` mark is shown; errors surface via `hlm-alert variant="destructive"` (not a raw `<p>`), with `aria-invalid`/`aria-describedby` on fields.
- [ ] `force-rotate.component.ts` is implemented (same card styling) and routes correctly after a successful rotation.
- [ ] Existing busy-disabled submit, busy label, and status→message mapping preserved; success path navigates cleanly.

## Tasks
- [TASK-1841] Rebuild `login.component.ts` on `hlm-card`/`hlm-field`/`hlm-input`/`hlmBtn` + `ob-brand`; keep `messageFor` logic.
- [TASK-1842] Surface login errors via `hlm-alert` + field `aria-invalid`/`aria-describedby` (live region from STORY-0600).
- [TASK-1843] Implement `force-rotate.component.ts` reusing the login card + `change-password` flow.
- [TASK-1844] Add auth i18n keys (en/de).

## Test plan
- [TEST-0608] E2E/manual: login success/failure (wrong creds → mapped error toast/alert); must-rotate user lands on a working force-rotate screen and proceeds; keyboard + screen-reader pass on the form.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0600], [STORY-0601]

## References
- UX review 2026-06-22 (design S4/F2; interaction F10; a11y F5).
- `apps/openbucket-frontend/src/app/auth/{login,force-rotate,auth.service}.ts`, `libs/ui/spartan/{card,field,input,button,alert,label}`.
