---
id: STORY-0604
title: Object browser rebuild — spartan table, multi-select, bulk delete, row actions
epic: EPIC-07
status: done
size: L
risk: medium
---

## User story
As an operator, I want a dense, keyboard-operable object table where I can multi-select and bulk-delete/-download, act on any row from a menu, and view details in a side sheet, so I can manage large buckets efficiently.

## Description
`object-browser.component.ts`/`object-row.component.ts` are raw HTML; the only row interaction is a host `(click)` on a `<tr>` (mouse-only, a11y failure) that opens an inline metadata aside; there is no selection model, no bulk ops, no row action menu, and list/HEAD/download errors are swallowed. Rebuild on spartan-ng with a real selection model and a `sheet`-based detail panel. Bulk delete calls the new admin endpoint from STORY-0612.

## Acceptance criteria
- [ ] Table uses `HlmTableImports`; rows are keyboard-operable (focusable control, Enter/Space), not a host-`(click)` `<tr>`; folder rows use `lucideFolder` (not the `📁` emoji) with an `sr-only` "Folder:" prefix.
- [ ] A selection model (header select-all + per-row `HlmCheckbox`) drives a bulk toolbar (Delete selected, Download selected) shown when `selection().size > 0`.
- [ ] Bulk delete calls the admin batch-delete endpoint (STORY-0612) and reports `{deleted, errors}` via toast; single delete added via the row menu.
- [ ] Each row has an `HlmDropdownMenu`: Copy key, Copy URL, Download, Delete, View details (copy uses the shared copy-button/toast).
- [ ] Object metadata moves into an `HlmSheet` (slides over, no layout push); list errors surface (no silent `try/finally`); `OnPush` + `@for track`.

## Tasks
- [TASK-1819] Rebuild `object-browser`/`object-row` on `HlmTableImports`; right-align Size, add Storage-Class column, truncate keys with `HlmTooltip`, monospace ETag; set `OnPush`.
- [TASK-1820] Make rows keyboard-operable (drop host `(click)`; focusable button + Enter/Space); fix folder icon + `sr-only` label.
- [TASK-1821] Add `selection = signal<Set<string>>()`, header/per-row `HlmCheckbox`, and a bulk toolbar.
- [TASK-1822] Wire bulk delete → admin batch-delete endpoint (STORY-0612) + `notify`; add single-row delete with confirm.
- [TASK-1823] Add per-row `HlmDropdownMenu` (copy key/URL via copy-button, download, delete, details).
- [TASK-1824] Move metadata into `HlmSheet`; add an `error` signal + catch on `load()`/`download()` with toasts.

## Test plan
- [TEST-0604] Unit (selection/computed) + e2e/manual: keyboard navigation opens folders/details; select-all + bulk delete; row menu actions; sheet opens; errors surface; large listing stays responsive.

## Dependencies
- Blocks: [STORY-0614], [STORY-0615]
- Blocked by: [STORY-0600], [STORY-0612] (batch-delete endpoint)

## References
- UX review 2026-06-22 (power-user A/F1-F5; a11y A11Y-2; design S2; interaction).
- `apps/openbucket-frontend/src/app/objects/{object-browser,object-row,objects.signal-store}.ts`, `libs/ui/spartan/{table,checkbox,dropdown-menu,sheet,tooltip,badge}`, `libs/api-client/src/lib/api/objects-admin.service.ts`.
