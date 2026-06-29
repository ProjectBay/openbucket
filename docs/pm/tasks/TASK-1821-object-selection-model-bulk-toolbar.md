---
id: TASK-1821
title: Add a selection model (select-all + per-row checkbox) and a bulk toolbar
story: STORY-0604
status: done
type: implementation
size: M
---

## Description
Add an object selection model to the browser: a `selection` signal of selected keys, a header "select all" checkbox, a per-row `HlmCheckbox`, and a bulk toolbar that appears when anything is selected. This is the substrate the bulk delete/download actions (TASK-1822) hang off; this task delivers the model + UI but leaves the destructive/transfer wiring to TASK-1822.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add `selection` signal, select-all, bulk toolbar, computed helpers)
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts` — modify (per-row checkbox cell + selection in/out bindings)

## Implementation notes
- State: `readonly selection = signal<Set<string>>(new Set<string>())` in `ObjectBrowserComponent`, keyed by object `key`. Add computed helpers, e.g. `selectedCount = computed(() => this.selection().size)` and an `allSelected`/`someSelected` computed comparing against `objects()` (folders are not selectable — only `contents`/`ObjectListItem` rows). Toggle helpers `toggle(key)` and `toggleAll()` must produce a NEW `Set` each time (`this.selection.set(new Set(next))`) so the `OnPush` change detection from TASK-1819 fires.
- Checkbox: import `HlmCheckboxImports` (`HlmCheckbox`) from `@openbucket/spartan-ui/checkbox`. Header cell gets a select-all `HlmCheckbox` bound to `allSelected`/indeterminate when `someSelected`; each object row gets a `HlmCheckbox` bound to `selection().has(o.key)` with `(changed)`/`(click)` toggling `toggle(o.key)`. Folder rows render no checkbox.
- Per-row plumbing: `object-row.component.ts` takes a `@Input() selected = false` and emits `@Output() toggleSelect`, OR the checkbox lives in a leading cell the parent controls — keep the checkbox interaction independent of the row "open" action from TASK-1820 (clicking the checkbox must not open the object). Add `aria-label` (e.g. "Select {{ objectLabel }}") to each checkbox.
- Bulk toolbar: a strip shown via `@if (selectedCount() > 0)` with the selected count and two `hlmBtn` actions — "Delete selected" and "Download selected" — both disabled/no-op stubs here (TASK-1822 wires them). Reset `selection` to an empty set when the prefix/page changes (hook into `load()`/`navigateTo()`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] A header select-all `HlmCheckbox` selects/clears all object rows; indeterminate state shows on partial selection; folders are never selectable.
- [ ] Per-row checkboxes toggle membership in `selection()` (a new `Set` each change) and carry an `aria-label`; clicking a checkbox does not open the object.
- [ ] The bulk toolbar appears only when `selectedCount() > 0` and shows the count plus Delete/Download buttons; changing prefix/page clears the selection.

## Test obligations
- Unit: covered by [TEST-0604] (toggle/toggleAll mutate the Set immutably; allSelected/someSelected computeds; selection clears on navigate).
- E2E: covered by [TEST-0604] (manual — select-all, partial select indeterminate, toolbar appears).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1819]

## References
- UX review 2026-06-22 (power-user A multi-select; design lens bulk toolbar).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`, `object-row.component.ts`, `libs/ui/spartan/checkbox` (`HlmCheckbox`), `@openbucket/api-client` (`ObjectListItem`).
