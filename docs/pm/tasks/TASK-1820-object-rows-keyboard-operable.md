---
id: TASK-1820
title: Make object rows keyboard-operable and fix the folder icon/label
story: STORY-0604
status: done
type: implementation
size: S
---

## Description
The only row interaction today is a host `(click)` on the `<tr>` (`object-row.component.ts:17`) — mouse-only, an a11y failure. Replace it with a focusable, keyboard-operable control (Enter/Space activates) so the row can be opened by keyboard, and replace the `📁` emoji folder marker (`:20`) with a `lucideFolder` icon plus an `sr-only` "Folder:" prefix so screen readers announce the row type.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts` — modify (drop host `(click)`; add focusable activator; folder icon + `sr-only` label)

## Implementation notes
- Remove the host click binding `host: { class: '...', '(click)': 'open.emit()' }` (`object-row.component.ts:17`). Make the primary cell (the name/folder label) a real focusable control — a `<button hlmBtn variant="link">` or an element with `(click)="open.emit()"` plus `(keydown.enter)="open.emit()"` and `(keydown.space)="open.emit(); $event.preventDefault()"` — so Enter/Space both activate it and tabbing reaches it. Keep `@Output() open`.
- Folder icon: register `lucideFolder` from `@ng-icons/lucide` via `provideIcons({ lucideFolder })` and render `<ng-icon name="lucideFolder" />` in place of the literal `📁` at `:20`. Add an `sr-only` span "Folder:" before the folder label so assistive tech distinguishes folders from objects. `folderLabel` (`(this.folder ?? '').slice(this.prefix.length).replace(/\/$/, '')`) and `objectLabel` getters stay.
- Preserve the attribute selector `tr[ob-object-row]` and table semantics from TASK-1819; only the interaction model and the folder marker change. Retain hover styling without relying on the row being the click target.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] No host `(click)` on the `<tr>` remains; the row's open action is reachable by Tab and activates on both Enter and Space.
- [ ] The `📁` emoji is gone; folder rows render `lucideFolder` with an `sr-only` "Folder:" prefix.
- [ ] Opening a folder (keyboard) navigates; opening an object (keyboard) triggers the same `open` path as a mouse click.

## Test obligations
- Unit: covered by [TEST-0604] (keydown.enter/space emit `open`).
- E2E: covered by [TEST-0604] (manual — keyboard navigation opens folders/details; screen-reader announces "Folder:").
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1819]

## References
- UX review 2026-06-22 (a11y lens A11Y-2 keyboard operability; power-user keyboard ops).
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts:17-29`, `@ng-icons/lucide` (`lucideFolder`), `libs/ui/spartan/{button,icon}`.
