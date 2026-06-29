---
id: TASK-1834
title: Add `webkitdirectory` folder upload (optional) and overwrite awareness
story: STORY-0606
status: done
type: implementation
size: S
---

## Description
Let operators upload an entire folder tree and warn them when an upload will overwrite an existing key. Add an optional `webkitdirectory` picker that preserves each file's relative path in the object key, and flag keys that already exist in the current listing so the operator isn't silently clobbering an object.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` — modify (add directory picker; relative-path keys; overwrite flag)

## Implementation notes
- Add a second, opt-in `<input type="file" webkitdirectory multiple>` (the `webkitdirectory` attribute makes the browser return a directory tree). When picking a directory, derive each file's key from its `webkitRelativePath` (e.g. `this.prefix + file.webkitRelativePath`) instead of just `file.name`, still `encodeURIComponent`-d exactly once before the PUT URL.
- Overwrite awareness: the parent `ObjectBrowserComponent` knows the current listing (`objects()` keys). Either accept an `@Input() existingKeys: string[]` (passed down from the browser) or have the parent pass a `Set<string>` of current keys; before starting a file whose key is already present, mark the row "will overwrite" (and optionally surface a `notify`/confirm). Keep it lightweight — this is awareness, not a hard block.
- `webkitRelativePath` / `webkitdirectory` are non-standard but supported in Chromium/Firefox; treat folder upload as optional/progressive — the flat multi-file picker (TASK-1830) remains the primary path.
- Reuse the `startMany`/`startOne` pipeline (including cancel/retry/summary from TASK-1832/1833); only the key derivation and the overwrite annotation change.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Picking a folder uploads its files with keys that preserve the relative path under the current prefix.
- [ ] A file whose key already exists in the current listing is flagged as an overwrite before/while uploading.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0606] (manual: folder upload preserves structure; overwrite flagged).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1830]

## References
- UX review 2026-06-22 (power-user — folder upload; interaction — overwrite awareness).
- `apps/openbucket-frontend/src/app/objects/object-upload.component.ts` (`startMany`, `startOne`, key derivation), `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`objects()` keys for overwrite check).
