---
id: TASK-1847
title: Wire the dashboard header "Create" action via PageHeaderService.setActionButton
story: STORY-0609
status: done
type: implementation
size: S
---

## Description
Wire a header-level "Create" action button for the dashboard through `PageHeaderService.setActionButton`, so the shell's page header (rendered in all three shell variants after STORY-0601) shows a primary "Create" entry point that opens the create-bucket flow. Clear the action when the component is destroyed so it does not leak onto other pages.

## Files to create / modify
- `apps/openbucket-frontend/src/app/home/home.component.ts` — modify (call `setActionButton` + `hideActionButton` on destroy)

## Implementation notes
- `PageHeaderService` (`layout/shell/services/page-header.service.ts`, `@Injectable({ providedIn: 'root' })`) exposes `setActionButton(label: string, callback: () => void): void`, `hideActionButton(): void`, `executeAction(): void`, plus readonly signals `showAction`/`actionLabel`. The header components render the button from these signals (STORY-0601 makes that render in all variants, not just compact).
- In `HomeComponent` constructor (after the existing `setPageHeader('Dashboard', …)`), call `this.pageHeader.setActionButton('Create', () => this.openCreate())`, where `openCreate()` triggers the same create-bucket flow used by the quick-actions card (TASK-1846) — keep a single create entry point.
- Register cleanup via `DestroyRef`/`inject(DestroyRef).onDestroy(() => this.pageHeader.hideActionButton())` (or `ngOnDestroy`) so the action button does not persist when navigating away from the dashboard.
- Do not duplicate `PageHeaderService` rendering logic in `HomeComponent`; only call the service — the shell owns the visual.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] On the dashboard, the shell page header shows a "Create" action button (in inset/sticky/compact variants).
- [ ] Clicking it opens the create-bucket flow (the same one as the quick-actions "Create bucket").
- [ ] Navigating away clears the action (header no longer shows "Create" on other pages).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0609] (header action opens the right dialog; clears on navigation).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1846]

## References
- UX review 2026-06-22 (IA B/F2; design — page-header action unification, STORY-0601).
- `apps/openbucket-frontend/src/app/home/home.component.ts`, `layout/shell/services/page-header.service.ts` (`setActionButton`/`hideActionButton`/`showAction`/`actionLabel`).
- Interfaces consumed: `PageHeaderService` (action-button rendering across variants from STORY-0601).
