---
id: TASK-1806
title: Unify the page title and render the action button across all shell variants
story: STORY-0601
status: done
type: refactor
size: M
---

## Description
Make the page title and `PageHeaderService` action button render through one consistent path in all three shell variants. Today the title renders three different ways: `ob-page-header` (`text-2xl`, in the content body), the compact header (`text-xl` inline `<h1>`), and the inset/sticky headers render no title at all — and only the compact header renders the action button. This task picks one rendering and applies it everywhere.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts` — modify (single source of truth: title + subtitle + action)
- `apps/openbucket-frontend/src/app/layout/shell/inset/components/inset-header.component.ts` — modify (render title/action via the shared path)
- `apps/openbucket-frontend/src/app/layout/shell/sticky/components/sticky-header.component.ts` — modify (render title/action via the shared path)
- `apps/openbucket-frontend/src/app/layout/shell/compact/components/compact-header.component.ts` — modify (drop the bespoke `<h1>` + action; use the shared path)

## Implementation notes
- `PageHeaderService` already exposes everything needed: `pageTitle()`, `pageSubtitle()`, `showAction()`, `actionLabel()`, `hasTabs()`, and `executeAction()` (plus `setActionButton(label, callback)` / `hideActionButton()`). Wire the action button to `(click)="pageHeader.executeAction()"` and gate it on `@if (pageHeader.showAction())`, exactly as `compact-header.component.ts` does today.
- Pick ONE title size/placement and apply it to all three variants — reuse `ob-page-header`'s `<h1 class="text-2xl font-semibold tracking-tight">` token, and extend `ob-page-header` to also render the action button (currently it renders title + subtitle only). The compact header's current `text-xl` `<h1>` and inline action should be removed in favour of the shared component so the hierarchy no longer changes per variant.
- The inset/sticky headers are the breadcrumb bars (`h-16` / `h-(--header-height)`); reconcile heights so the title row is the same height across variants. Render the action button on the right (`justify-between` / `ml-auto`) consistent with compact's current `<header class="flex h-16 items-center justify-between …">`.
- The compact action uses `lucidePlus` via `provideIcons({ lucidePlus, lucidePanelLeft })`; if the action button moves into `ob-page-header`, move the `lucidePlus` registration with it and keep `lucidePanelLeft` on the compact header (it drives the mobile sidebar toggle).
- Keep `PageSubheaderComponent` / `hasTabs()` behaviour intact (the `[class.border-b]="!pageHeader.hasTabs()"` rule in `ob-page-header`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] In all three variants the page title renders through one component/size and the `PageHeaderService` action button appears (not only compact) when `showAction()` is true; clicking it calls `executeAction()`.
- [ ] No variant renders the title at a different size than the others (single `<h1>` token).

## Test obligations
- Unit: covered by [TEST-0601] (action button visibility tracks `showAction()`).
- E2E: covered by [TEST-0601] (title + action render identically across inset/sticky/compact).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1804]

## References
- UX review 2026-06-22 (design lens F10 — three title sizes/placements; F12 — action button only in compact).
- `apps/openbucket-frontend/src/app/layout/shell/services/page-header.service.ts`, `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts`, `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/*-header.component.ts`.
- Interfaces consumed: `PageHeaderService` (`setActionButton`, `showAction`, `executeAction`).
