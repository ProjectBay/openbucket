---
id: TASK-1823
title: Add a per-row HlmDropdownMenu (copy key/URL, download, delete, details)
story: STORY-0604
status: done
type: implementation
size: M
---

## Description
Give every object row an actions menu (`HlmDropdownMenu`) with: Copy key, Copy URL, Download, Delete, and View details. Copy actions reuse the shared `CopyButtonComponent`/`notify` from STORY-0600; Download reuses the existing authenticated blob fetch; Delete reuses the confirmed single-delete from TASK-1822; View details opens the side sheet from TASK-1824.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts` — modify (add a trailing actions cell with the dropdown menu)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (handle the row-action outputs: copy/download/delete/details)

## Implementation notes
- Menu: import `HlmDropdownMenuImports` from `@openbucket/spartan-ui/dropdown-menu` (`HlmDropdownMenuTrigger`, `HlmDropdownMenuItem`, `HlmDropdownMenuSeparator`, ...). Trigger is an `hlmBtn variant="ghost" size="icon-sm"` with `<ng-icon name="lucideEllipsis" />` (register `lucideEllipsis` via `provideIcons`). Place it in a trailing, right-aligned actions cell on object rows only (folders get no actions menu, or only "open").
- Items:
  - Copy key → reuse `CopyButtonComponent` (STORY-0600) or call the same clipboard+`notify` path with `o.key`.
  - Copy URL → copy the content URL. The browser already builds it as `/api/admin/buckets/${bucket}/objects/${encodeURIComponent(key)}?content` (`object-browser.component.ts` `contentUrl(key)`); expose that string to the row (input or via an output the parent resolves) so the copied URL matches what the app fetches.
  - Download → reuse `ObjectBrowserComponent.download(key)` (existing authenticated blob fetch + `URL.createObjectURL` + anchor click).
  - Delete → trigger the confirmed single-delete path from TASK-1822.
  - View details → emit an output the parent maps to opening the detail sheet (TASK-1824).
- Wire row → parent via `@Output()`s (e.g. `copyKey`, `copyUrl`, `downloadObject`, `deleteObject`, `viewDetails`) handled in `object-browser.component.ts`, since the URL builder, download, delete, and sheet all live on the parent. Each menu item needs an accessible label; the trigger button needs an `aria-label` (e.g. "Actions for {{ objectLabel }}").
- Keep the menu's open/activation independent of the row "open" (TASK-1820) and the selection checkbox (TASK-1821) — clicking the menu trigger must not navigate or toggle selection.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Each object row has an `HlmDropdownMenu` (ellipsis trigger with `aria-label`) offering Copy key, Copy URL, Download, Delete, View details.
- [ ] Copy key/URL write to the clipboard and fire a "Copied" toast (via the shared copy mechanism); the copied URL equals the app's `?content` URL.
- [ ] Download fetches and saves the object; Delete runs the confirmed delete; View details opens the sheet.

## Test obligations
- Unit: covered by [TEST-0604] (row emits the right action outputs; copy writes clipboard + toast).
- E2E: covered by [TEST-0604] (manual — each menu action works; menu doesn't trigger row open/select).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1820], [TASK-1822]

## References
- UX review 2026-06-22 (power-user F1-F5 row actions; interaction copy feedback).
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts`, `object-browser.component.ts` (`contentUrl`, `download`), `libs/ui/spartan/{dropdown-menu,button,icon}`, `@ng-icons/lucide` (`lucideEllipsis`), `shared/ui/{copy-button.component,notify}.ts` (STORY-0600).
