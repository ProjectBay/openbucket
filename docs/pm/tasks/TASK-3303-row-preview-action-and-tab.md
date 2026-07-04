---
id: TASK-3303
title: Wire a per-row Preview action and detail-sheet preview tab
story: STORY-1100
status: backlog
type: implementation
size: S
---

## Description
Surface preview as a first-class affordance in the object browser: add a "Preview"
item to the existing per-row `HlmDropdownMenu`, and render the extracted
`ObjectPreviewComponent` in the detail sheet so opening a row (or the Preview action)
lands the operator on a usable preview without leaving the console.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify
  (add a `Preview` row-menu item calling `openObject(o)`; replace the inline
  `@switch (previewKind())` block in the `details` tab with
  `<ob-object-preview [bucket]="bucket()" [meta]="meta" />`; add `lucideEye` to the
  icon provider set + imports)
- `apps/openbucket-frontend/public/i18n/en.json` (and siblings) — modify
  (add `objects.preview` label)

## Implementation notes
- Row menu: add above "View details":
  ```html
  <button hlmDropdownMenuItem (click)="openObject(o)">
    <ng-icon name="lucideEye" /> {{ 'objects.preview' | translate }}
  </button>
  ```
  Reuse the existing `openObject(o)` path (it already HEADs the object via
  `objects$.getObject`, opens `detailSheet`, and set `selected()`). The
  `ObjectPreviewComponent` reacts to `selected()` through its `meta` input, so no
  new fetch orchestration is needed in the browser.
- Register `ObjectPreviewComponent` in the component `imports` array and remove the
  now-dead preview markup (`@if (previewLoading()) … @switch (previewKind())`).
- Keep the sheet's `details` tab as the default; the preview renders at the top of
  that tab above the metadata `<dl>` exactly where the current inline preview sits,
  so the visual layout is unchanged for image/PDF and newly populated for text.
- The detail sheet's Download button (`download(meta.key)`) and the fallback card's
  Download must both hit the `?download` attachment route — no duplication: expose a
  `(download)` output from `ObjectPreviewComponent` that the browser wires to its
  existing `download(key)`.
- Accessibility: the new menu item is a real `<button hlmDropdownMenuItem>` (keyboard
  operable, consistent with the [STORY-0604] row-menu pattern); the preview `<img>`
  keeps `[alt]="meta.key"`.
- Security: no new endpoint or fetch surface — everything routes through the same
  guarded `?content` / `?download` admin paths.

## Acceptance criteria
- [ ] The row `HlmDropdownMenu` has a "Preview" item that opens the sheet and shows
  the preview for image / PDF / text objects.
- [ ] The `details` tab renders `<ob-object-preview>`; no `previewKind()` switch
  remains in `object-browser.component.ts`.
- [ ] Downloading from the preview fallback and from the sheet footer both produce an
  attachment (`?download`), verified manually.
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.

## Test obligations
- Unit: covered by [TEST-1100] (menu item present; preview host renders)
- E2E: covered by [TEST-1100] (manual: row menu → Preview → renders)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3300]

## References
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — row menu
  `#rowMenu` (~435–497), `openObject` (~1124–1145), the `details` `hlmTabsContent`
  block (~546–601), the `provideIcons({...})` set (~117–141).
