---
id: TASK-1886
title: Table scope / heading-hierarchy / decorative-icon pass on rebuilt screens
story: STORY-0616
status: done
type: implementation
size: S
---

## Description
Apply table and heading semantics across the rebuilt EPIC-07 screens: `<th scope>` on every data table header cell, exactly one `<h1>` per page with a correct heading hierarchy, and sidebar/decorative icons marked so screen readers skip them.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (`<th scope="col">`; resolve heading levels)
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/keys/keys-list.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/layout/sidebar/components/sidebar-renderer.component.ts` — modify (mark group/item icons decorative)

## Implementation notes
- Tables: every `<th>` gets `scope="col"` (row headers, if any, `scope="row"`) so the header/cell association is announced (WCAG 1.3.1 Info and Relationships). The current object table (`object-browser.component.ts` lines 62–84) uses bare `<th class="p-3">Name</th>` etc.; the rebuilt `HlmTableImports` version (STORY-0604) must carry `scope`. Same for the buckets table (`bucket-list.component.ts`) and keys table.
- Heading hierarchy: ensure exactly one `<h1>` per routed page (the page title; the shell `PageHeaderService.pageTitle()` may already render it — verify it is an `<h1>` and that feature components do not also emit a competing `<h1>`). Detail panels (e.g. the object sheet's `<h2 class="font-medium">{{ meta.key }}</h2>`, line 89) stay at the correct sub-level under the page `<h1>`.
- Decorative icons: icons rendered adjacent to a text label (sidebar group/item icons in `sidebar-renderer.component.ts`, folder icon next to the folder name) are decorative — mark them `aria-hidden="true"` so the name isn't read twice. The folder `lucideFolder` icon (replacing the `📁` emoji per STORY-0604/TASK-1820) gets `aria-hidden="true"` with an `sr-only` "Folder:" prefix on the label.
- These a11y rules being re-enabled in TASK-1887 (`elements-content`, `valid-aria`) will flag empty/incorrect markup; this task clears the residual violations on the data screens.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass with a11y rules at `error`.
- [ ] Every data-table `<th>` carries `scope`; navigating the table by cell announces the column header (manual: NVDA table mode).
- [ ] Each routed page has exactly one `<h1>`; no duplicate/competing top-level headings.
- [ ] Icons adjacent to labels are `aria-hidden="true"`; the folder label is announced once with its `sr-only` prefix.

## Test obligations
- Unit: N/A (markup change).
- E2E: covered by [TEST-0616] (manual: screen-reader table + heading navigation).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0603], [STORY-0604]

## References
- UX review 2026-06-22 (a11y A11Y-4/5 — table semantics, heading hierarchy, decorative icons; WCAG 1.3.1).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`<th>` lines 62–84, `<h2>` line 89), `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts`, `apps/openbucket-frontend/src/app/layout/sidebar/components/sidebar-renderer.component.ts`.
