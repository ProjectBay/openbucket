---
id: TASK-1831
title: Add a `dragOver` signal + dropzone highlight on dragover/leave/drop
story: STORY-0606
status: done
type: implementation
size: S
---

## Description
Give the drop zone visible drag feedback. Add a `dragOver` signal that toggles a highlighted state on `dragover`, clears on `dragleave`/`drop`, and drives a Tailwind highlight class on the dropzone. Since the dropzone is a mouse-only affordance, mark its decorative visuals `aria-hidden` and rely on the keyboard-reachable `<label>`/button from TASK-1830 as the named alternative.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` — modify (add `dragOver` signal + handlers + class binding)

## Implementation notes
- Add `readonly dragOver = signal(false);`.
- The component already has `onDragOver(e)` (calls `e.preventDefault()`) and `onDrop(e)` (prevents default + `startMany`). Extend them: `onDragOver` → `e.preventDefault(); this.dragOver.set(true)`; add `onDragLeave(e)` → `this.dragOver.set(false)`; `onDrop` → `e.preventDefault(); this.dragOver.set(false); ...startMany`.
- Wire `(dragleave)="onDragLeave($event)"` on the dropzone `<div>` alongside the existing `(dragover)`/`(drop)`.
- Bind the highlight, e.g. `[class.border-primary]="dragOver()"` / `[class.bg-accent]="dragOver()"` (or equivalent tokens) on the existing `rounded border-2 border-dashed` container.
- Mark the purely decorative dropzone text/visual `aria-hidden="true"`; the accessible name and keyboard path come from the labelled input/`hlmBtn` trigger (TASK-1830), which must remain operable.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Dragging files over the zone highlights it; leaving or dropping removes the highlight.
- [ ] The decorative dropzone is `aria-hidden`; a keyboard user can still start an upload via the labelled control.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0606] (drag highlight on/off; keyboard alternative).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1830]

## References
- UX review 2026-06-22 (interaction D — no drag-over state; a11y F3 — mouse-only dropzone).
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` (`onDragOver`, `onDrop`, dropzone `<div>`).
