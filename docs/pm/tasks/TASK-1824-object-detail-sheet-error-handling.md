---
id: TASK-1824
title: Move object metadata into an HlmSheet and surface list/HEAD/download errors
story: STORY-0604
status: done
type: implementation
size: M
---

## Description
Move the inline metadata `<aside>` (`object-browser.component.ts:86-127`) into an `HlmSheet` that slides over from the side without pushing layout, and stop swallowing errors: add an `error` signal and `catch` the list/HEAD/download paths (`load()`, `openObject()`, `download()`) so failures surface via the `error` signal and `notify` toasts instead of the current silent `try/finally` and empty `catch {}`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (sheet for metadata; `error` signal; catch on load/openObject/download)

## Implementation notes
- Sheet: import `HlmSheetImports` from `@openbucket/spartan-ui/sheet` (`HlmSheet`, `HlmSheetContent`, `HlmSheetHeader`, `HlmSheetTitle`, `HlmSheetDescription`, `HlmSheetClose`, ...). Move the existing `dl` metadata grid (Size/Content-Type/ETag/Modified/Version), the image preview (`previewUrl`/`previewLoading`), and the Download button from the `@if (selected(); as meta) { <aside> }` block into the sheet content. "View details" (TASK-1823) and the row-open path open the sheet; closing it calls `closeMeta()` (which already runs `clearPreview()` and `selected.set(null)`). The sheet must slide over, not push the table.
- Errors: add `readonly error = signal<string | null>(null)`. In `load()` (`:243-259`) the current `try { ... } finally { this.loading.set(false) }` swallows list failures — add a `catch` that sets `error` and fires `notify.error(...)`. In `openObject()` (`:185-203`) the image-preview `catch {}` may stay best-effort, but a failed HEAD (`getObject`) should set `error`/toast rather than silently leaving `selected` null. In `download()` (`:206-216`) wrap the blob fetch in try/catch and toast on failure.
- Render the `error` signal in the UI (e.g. an `hlm-alert`/inline banner above the table) so a failed listing is visible, not just toasted. Keep `OnPush` (TASK-1819) — set signals, don't mutate.
- Preserve the existing preview lifecycle (`previewRaw`, `URL.createObjectURL`/`revokeObjectURL`, `clearPreview()`) and the `contentUrl(key, download?)` helper.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Object metadata (and image preview + download) renders in an `HlmSheet` that slides over without pushing the table; closing it clears the preview and selection.
- [ ] A failed list (`load()`) sets the `error` signal, shows an inline error, and fires an error toast — no silent `try/finally`.
- [ ] A failed HEAD (`getObject`) or download surfaces via toast rather than failing silently.

## Test obligations
- Unit: covered by [TEST-0604] (load() failure sets `error` + toasts; openObject HEAD failure surfaces; sheet open/close clears state).
- E2E: covered by [TEST-0604] (manual — sheet slides over, no layout push; induced 500 on list shows error; download failure toasts).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1819]

## References
- UX review 2026-06-22 (interaction error surfacing; design lens side-sheet; a11y A11Y-2).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts:86-127` (aside), `:185-216` (openObject/download), `:243-259` (load), `libs/ui/spartan/sheet` (`HlmSheetImports`), `shared/ui/notify.ts` (STORY-0600), `@openbucket/api-client` (`ObjectMetaDto`).
