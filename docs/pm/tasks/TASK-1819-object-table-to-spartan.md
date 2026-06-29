---
id: TASK-1819
title: Rebuild object-browser/object-row on HlmTableImports with dense columns and OnPush
story: STORY-0604
status: done
type: refactor
size: M
---

## Description
Rebuild the raw HTML table in `object-browser.component.ts:62-84` and the raw-cell `object-row.component.ts` on the design-system table (`HlmTableImports`). Make the listing dense and information-rich: right-align the Size column, add a Storage-Class column (the API already returns it), truncate long keys with an `HlmTooltip`, and render the ETag in monospace. Set both components to `ChangeDetectionStrategy.OnPush` and keep `@for` rows on a stable `track`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (swap table markup; `OnPush`)
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts` — modify (cells to `hlmTd`; add Storage-Class + tooltip; `OnPush`)

## Implementation notes
- Table set: `HlmTableImports` from `@openbucket/spartan-ui/table` (`HlmTable`, `HlmTBody`, `HlmTHead`, `HlmTr`, `HlmTh`, `HlmTd`, ...). Keep the attribute-selector row pattern — `object-row.component.ts` is `selector: 'tr[ob-object-row]'`, which preserves table semantics; apply `hlmTd` to its `<td>` cells and `hlmTr`/`hlmTh` in the parent header.
- Columns: Name | Size (right-aligned, `text-right`) | Storage Class | Modified | ETag (monospace). `ObjectListItem` provides `key`, `size`, `etag`, `lastModified`, `storageClass` — render `storageClass` in a new column (currently dropped). Keep `ByteSizePipe` for size and `RelativeTimePipe` for modified.
- Long keys: wrap the name cell text with `HlmTooltipImports` (`HlmTooltip`, `HlmTooltipTrigger`) from `@openbucket/spartan-ui/tooltip` and a `truncate`/`max-w-*` class so the full key shows on hover. ETag cell keeps `font-mono text-xs`.
- Set `changeDetection: ChangeDetectionStrategy.OnPush` on both components. The parent already tracks correctly: `@for (f of folders(); track f)` and `@for (o of objects(); track o.key)` — keep these stable tracks.
- Folder rows keep their attribute-selector `<tr ob-object-row [folder]="f">`; the folder-icon/keyboard work lands in TASK-1820, selection checkboxes in TASK-1821 — leave hooks for those (don't remove the host binding yet; TASK-1820 owns that change).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The listing renders via `hlmTable`/`hlmTr`/`hlmTh`/`hlmTd` (no raw `<table class="w-full text-left text-sm">`).
- [ ] Size is right-aligned; a Storage-Class column shows `ObjectListItem.storageClass`; ETag is monospace; long keys truncate with a tooltip revealing the full key.
- [ ] Both `ObjectBrowserComponent` and `ObjectRowComponent` declare `ChangeDetectionStrategy.OnPush`.

## Test obligations
- Unit: covered by [TEST-0604] (build/lint anchors; component renders with OnPush).
- E2E: covered by [TEST-0604] (manual — dense columns, tooltip on long keys, large listing stays responsive).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (design lens S2 dense table; power-user A density).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts:62-84`, `object-row.component.ts`, `libs/ui/spartan/{table,tooltip}`, `@openbucket/api-client` (`ObjectListItem`).
