---
id: TASK-1841
title: Rebuild the login form on hlm-card / hlm-field / hlm-input / hlmBtn + ob-brand
story: STORY-0608
status: done
type: implementation
size: M
---

## Description
Rebuild `login.component.ts` so the admin sign-in screen is on the design system instead of raw `<input>`/`<button>` markup. Wrap the form in an `hlmCard`, render each field through `hlm-field` + `hlmLabel` + `hlmInput`, submit through an `hlmBtn`, and show the `ob-brand` mark above the heading. The `messageFor` status→message mapping, busy-disabled submit, busy label, and the `AuthService.login` success path must be preserved verbatim — this is a presentation rebuild, not a logic change.

## Files to create / modify
- `apps/openbucket-frontend/src/app/auth/login.component.ts` — modify (replace template + imports; keep the component class logic)

## Implementation notes
- Keep the existing class surface: `username`, `password`, `readonly error = signal<string | null>(null)`, `readonly busy = signal(false)`, `onSubmit()`, and the private `messageFor(e: unknown): string` (it maps `status === 400 || 401` → `'Invalid username or password.'`, `status === 0` → `'Cannot reach the server.'`, else the generic message). Do not change `AuthService.login(username, password)` or its `/force-rotate` vs `/buckets` navigation.
- Card: import `HlmCardImports` from `@openbucket/spartan-ui/card` and structure the form with `[hlmCard]` + `[hlmCardHeader]`/`[hlmCardTitle]`/`[hlmCardDescription]` + `[hlmCardContent]` + `[hlmCardFooter]`.
- Fields: import `HlmFieldImports` from `@openbucket/spartan-ui/field`, `HlmInput` from `@openbucket/spartan-ui/input`, `HlmLabel` from `@openbucket/spartan-ui/label`. Each field is an `[hlmField]` wrapping an `[hlmLabel]` and an `input hlmInput` bound with `[(ngModel)]` (keep `FormsModule`); preserve `name`/`autocomplete="username"`/`autocomplete="current-password"`/`type="password"`/`required`.
- Button: import `HlmButton` from `@openbucket/spartan-ui/button`; the submit is `button hlmBtn type="submit" [disabled]="busy()"` with the existing label expression `{{ busy() ? 'Signing in…' : 'Sign in' }}` (until i18n lands in TASK-1844).
- Brand: render `<ob-brand />` (the `BrandComponent`, selector `ob-brand`, produced by STORY-0601/TASK-1805) centered above the card title. Import the `BrandComponent` from the shell components barrel created in STORY-0601.
- Keep the outer centered `<main class="flex min-h-screen items-center justify-center …">` layout (login renders outside the app shell).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (run on Node 23 — the frontend toolchain; the backend is the Node-20 one).
- [ ] The rendered login uses `hlmCard`, `hlm-field`/`hlmLabel`/`hlmInput`, and an `hlmBtn` submit (no raw `<input class="…border…">`/`<button class="…bg-primary…">` left in the template).
- [ ] `<ob-brand />` renders above the title.
- [ ] Submitting wrong credentials still yields the `messageFor`-mapped string; the submit is disabled while `busy()`.

## Test obligations
- Unit: N/A (presentation; logic unchanged).
- E2E: covered by [TEST-0608] (login success/failure flow, keyboard/screen-reader pass).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0601]

## References
- UX review 2026-06-22 (design S4; interaction F10 — raw controls, no brand mark).
- `apps/openbucket-frontend/src/app/auth/{login.component.ts,auth.service.ts}`, `libs/ui/spartan/{card,field,input,label,button}` (`@openbucket/spartan-ui/{card,field,input,label,button}`), `ob-brand` (`BrandComponent`, produced by STORY-0601).
- Interfaces consumed: `BrandComponent` (STORY-0601), `AuthService.login` (existing).
