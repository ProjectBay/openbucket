---
id: TASK-1830
title: Swap native `<progress>` → HlmProgress; wrap input in a real `<label>` + sr-only instructions
story: STORY-0606
status: done
type: implementation
size: S
---

## Description
Replace the unstyled native `<progress>` bar with the design-system `HlmProgress`, and make the file picker accessible: wrap the `<input type="file">` in a real `<label>` ("Upload files to {prefix}") with screen-reader instructions, and present the click target as an `hlmBtn`-styled trigger instead of the raw browser control. No upload-flow logic changes here.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` — modify (template: progress + labelled input/trigger)

## Implementation notes
- Import `HlmProgressImports` from `@openbucket/spartan-ui/progress` (`HlmProgress, HlmProgressIndicator`). Replace `<progress [value]="u.progress" max="100">` with `HlmProgress` driven by the same `u.progress` (0–100) value.
- Import `HlmButtonImports` from `@openbucket/spartan-ui/button` and apply the `hlmBtn` directive to the trigger.
- Accessibility: wrap the native `<input type="file" multiple (change)="onPick($event)">` in a `<label>` whose visible text is `Upload files to {{ prefix || '(bucket root)' }}`; add an `sr-only` span with instructions (e.g. "Press Enter to choose files, or drag files onto the drop zone"). Keep the input keyboard-reachable (do not set `display:none`; use `sr-only`/clip so it stays focusable, or trigger it from the styled button).
- Keep `crypto.randomUUID()` ids, the `encodeURIComponent(prefix + name)` (encoded exactly once) key derivation, and the PUT-with-progress pipeline unchanged.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23; a11y lint rules included).
- [ ] Per-file progress renders via `HlmProgress` and tracks `0→100` during an upload.
- [ ] The picker has an associated `<label>` naming the destination prefix and is reachable/operable by keyboard.

## Test obligations
- Unit: N/A (UI).
- E2E: covered by [TEST-0606] (progress renders; label present; keyboard focus).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (interaction D — native controls; a11y F3 — unlabeled picker).
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` (template, `onPick`, `startOne`), `libs/ui/spartan/progress` (`HlmProgressImports`), `libs/ui/spartan/button` (`HlmButtonImports`/`hlmBtn`).
