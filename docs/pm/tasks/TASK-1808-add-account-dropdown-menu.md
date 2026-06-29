---
id: TASK-1808
title: Add an account/identity dropdown with logout to the sidebar footer
story: STORY-0601
status: done
type: implementation
size: S
---

## Description
Add an account menu (avatar + username + logout) to the sidebar footer so an admin can see who they are signed in as and sign out from the shell. There is currently no identity affordance and no logout path in the UI even though `AuthService.logout()` exists. Render it via the spartan dropdown-menu already imported by the renderer.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/components/account-menu.component.ts` — new (`ob-account-menu`)
- `apps/openbucket-frontend/src/app/layout/shell/components/index.ts` — modify (export `AccountMenuComponent`)
- `apps/openbucket-frontend/src/app/layout/shell/compact/components/compact-sidebar.component.ts` — modify (place `<ob-account-menu />` in `<hlm-sidebar-footer>`)
- `apps/openbucket-frontend/src/app/layout/shell/inset/components/inset-sidebar.component.ts` — modify (add a footer with `<ob-account-menu />`)
- `apps/openbucket-frontend/src/app/layout/shell/sticky/components/sticky-sidebar.component.ts` — modify (add a footer with `<ob-account-menu />`)

## Implementation notes
- Compose the avatar from `HlmAvatarImports` (`import { HlmAvatarImports } from '@openbucket/spartan-ui/avatar';` → `HlmAvatar`, `HlmAvatarImage`, `HlmAvatarFallback`) and the menu from `HlmDropdownMenuImports` (`import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';` → exposes `hlmDropdownMenuTrigger`, `hlm-dropdown-menu`, `hlmDropdownMenuItem`, `hlm-dropdown-menu-label`, `hlm-dropdown-menu-separator`). The renderer already imports `HlmDropdownMenuImports`, so the pattern is established in-repo.
- Inject `AuthService` (`apps/openbucket-frontend/src/app/auth/auth.service.ts`): bind the trigger label to `auth.username()` (a `computed` signal, `string | null`) and the logout item to `(click)="auth.logout()"` (returns `Promise<void>` and navigates to `/login`). Use a fallback like the first letter of `username()` for `hlm-avatar-fallback` when there is no image.
- Use `lucideLogOut` (and optionally `lucideUser` for the menu header) via `provideIcons({ lucideLogOut })` on `AccountMenuComponent`; both are real `@ng-icons/lucide` exports. Keep these registrations local to the account-menu component (do not add them to the renderer's pruned set unless the renderer renders them).
- Mount one `<ob-account-menu />` per variant in the sidebar footer: `compact-sidebar` already has `<hlm-sidebar-footer>` (currently holds `secondaryNavConfig`); inset/sticky have no footer yet, so add an `<hlm-sidebar-footer>` (from `HlmSidebarImports`, already imported) before the closing `</hlm-sidebar>`.
- Render it inside `<li hlmSidebarMenuItem>` / `<a hlmSidebarMenuButton size="lg">` so it matches the brand row styling; the dropdown side/align can mirror the renderer's `right`/`start` desktop default.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] The sidebar footer shows the signed-in username + avatar in all three variants; opening the menu and clicking Logout calls `AuthService.logout()` and navigates to `/login`.
- [ ] Exactly one account menu renders per shell variant (no duplicate triggers).

## Test obligations
- Unit: covered by [TEST-0601] (logout item invokes `AuthService.logout`; if frontend jest is wired).
- E2E: covered by [TEST-0601] (logout works from the account menu).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1805]

## References
- UX review 2026-06-22 (IA lens F5 — no identity/logout in shell).
- `apps/openbucket-frontend/src/app/auth/auth.service.ts` (`username`, `logout`), `libs/ui/spartan/avatar/src/index.ts` (`HlmAvatarImports`), `libs/ui/spartan/dropdown-menu/src/index.ts` (`HlmDropdownMenuImports`), `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/*-sidebar.component.ts`.
- Interfaces consumed: `AuthService`.
