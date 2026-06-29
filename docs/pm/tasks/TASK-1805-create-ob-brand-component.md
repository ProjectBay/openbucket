---
id: TASK-1805
title: Create the `ob-brand` component and replace the triplicated brand block
story: STORY-0601
status: done
type: implementation
size: S
---

## Description
Extract the brand block (mark + wordmark) that is copy-pasted into the inset, sticky, and compact sidebars into a single `ob-brand` component, and canonicalise the casing to "OpenBucket". The three sidebars currently each inline `<ng-icon name="lucideCommand" />` plus a hard-coded `Openbucket` / `Workspace` two-line label; this task replaces all three with one component.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/components/brand.component.ts` — new (`ob-brand`)
- `apps/openbucket-frontend/src/app/layout/shell/components/index.ts` — modify (export `BrandComponent`)
- `apps/openbucket-frontend/src/app/layout/shell/inset/components/inset-sidebar.component.ts` — modify (replace brand block)
- `apps/openbucket-frontend/src/app/layout/shell/sticky/components/sticky-sidebar.component.ts` — modify (replace brand block)
- `apps/openbucket-frontend/src/app/layout/shell/compact/components/compact-sidebar.component.ts` — modify (replace brand block)

## Implementation notes
- Author `BrandComponent` as `selector: 'ob-brand'`, `standalone: true`, `changeDetection: ChangeDetectionStrategy.OnPush`. Render the mark as inline SVG using `fill="currentColor"` / `stroke="currentColor"` (NOT a lucide glyph) so it inherits `text-sidebar-primary-foreground`, and the wordmark as the literal text `OpenBucket` (canonical casing — replaces the current lowercase-b `Openbucket`).
- Preserve the existing markup contract each sidebar relies on: the brand sits inside `<li hlmSidebarMenuItem><a hlmSidebarMenuButton size="lg">…</a></li>`, with the mark in a `bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg` box and a `grid flex-1 text-left text-sm leading-tight` label column (`font-medium` wordmark over an `text-xs` "Workspace" subline). Keep the same Tailwind classes so all three variants look unchanged apart from the corrected casing and shared SVG.
- After swapping in `<ob-brand />`, drop the now-unused `provideIcons({ lucideCommand, lucideChevronsUpDown })` and the `lucideCommand`/`lucideChevronsUpDown` imports from each sidebar if no other markup uses them (the brain dropdown trigger does not; verify per file before removing).
- Add `BrandComponent` to each sidebar component's `imports: [...]` array; export it from the shell `components/index.ts` barrel next to `PageHeaderComponent` / `PageSubheaderComponent`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (no unused-import warnings for `lucideCommand`).
- [ ] All three sidebars render the brand via `<ob-brand />`; the wordmark reads exactly `OpenBucket` in every variant.
- [ ] The brand mark is inline SVG using `currentColor` (verifiable by `grep "currentColor" brand.component.ts`).

## Test obligations
- Unit: covered by [TEST-0601] (brand renders canonical casing; if frontend jest is wired).
- E2E: covered by [TEST-0601] (visual parity across the 3 variants).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1804]

## References
- UX review 2026-06-22 (design lens F8 — triplicated brand; F9 — casing "Openbucket" vs "OpenBucket").
- `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/*-sidebar.component.ts`, `apps/openbucket-frontend/src/app/layout/shell/components/index.ts`.
- Interfaces produced: `BrandComponent` (`ob-brand`).
