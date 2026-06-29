---
id: TASK-1882
title: Skip link + route-change focus/announce in DynamicShellLayout
story: STORY-0616
status: done
type: implementation
size: M
---

## Description
Add a skip-to-content link as the first focusable element of the app and announce + focus the main content region on every route change. The skip link targets `<main>`; route changes move focus to `<main>` and announce the page title via the shared `StatusAnnouncer` (CDK `LiveAnnouncer`).

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts` — modify (render the skip link first; subscribe to `Router` events; call `StatusAnnouncer` + focus `<main>`)
- `apps/openbucket-frontend/src/app/layout/shell/inset/inset-shell.component.ts` — modify (give `<main>` an `id` + `tabindex="-1"` so it is a focus/skip target)
- `apps/openbucket-frontend/src/app/layout/shell/sticky/sticky-shell.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/layout/shell/compact/compact-shell.component.ts` — modify (same)

## Implementation notes
- Each shell variant already renders `<main hlmSidebarInset ...>` containing the `<router-outlet />`. Add a stable target id, e.g. `<main id="main-content" tabindex="-1" ...>`, on all three variant templates (`inset`/`sticky`/`compact`).
- Skip link: an `<a href="#main-content">` placed as the first child in `DynamicShellLayout`'s template (before the variant switch), visually hidden until focused (`sr-only focus:not-sr-only` Tailwind utilities) so it is the first focusable element. Clicking/activating it moves focus to `#main-content` (WCAG 2.4.1 Bypass Blocks).
- Route announce: inject `Router` and `StatusAnnouncer` (TASK-1803, `@Injectable({ providedIn: 'root' })` wrapping CDK `LiveAnnouncer`). On `NavigationEnd`, focus `#main-content` (`document.getElementById(...).focus()` or a `@ViewChild`) and call `StatusAnnouncer.announce(pageTitle, 'polite')` using `PageHeaderService.pageTitle()` (resolved via `translate` so the announcement is localized) — WCAG 2.4.3 Focus Order + 4.1.3 Status Messages.
- `DynamicShellLayout` is `OnPush` + `ViewEncapsulation.None`; keep both. No visual change except the skip link on focus.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Tab from page load: the first focusable element is the skip link; activating it moves focus into `<main id="main-content">`.
- [ ] On every route change, focus moves to `<main>` and the page title is announced via `LiveAnnouncer` (manual: NVDA/VoiceOver).
- [ ] All three shell variants (inset/sticky/compact) expose the `#main-content` target.

## Test obligations
- Unit: covered by [TEST-0616] (NavigationEnd → announce + focus called).
- E2E: covered by [TEST-0616] (manual keyboard + screen-reader run-through).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0603], [STORY-0604]

## References
- UX review 2026-06-22 (a11y A11Y-3/4 — no skip link, no route announce; WCAG 2.4.1, 2.4.3, 4.1.3).
- `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts`, `.../{inset,sticky,compact}/*-shell.component.ts` (`<main hlmSidebarInset>`), `apps/openbucket-frontend/src/app/layout/shell/services/page-header.service.ts` (`pageTitle()`), `@angular/router` (`NavigationEnd`).
- Interfaces consumed: `StatusAnnouncer` (TASK-1803).
