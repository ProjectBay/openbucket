---
id: TASK-1255
title: Implement ObjectRowComponent (folder vs object)
story: STORY-0418
status: done
type: implementation
size: XS
---

## Description
Single-row component that renders either a "folder" (common prefix) or an object. Folder click → emits `enterPrefix` with the new prefix. Object click → emits `selectObject` with the key (caller opens the metadata side-panel).

## Files to create / modify
- `apps/frontend/src/app/objects/object-row.component.ts` — new

## Implementation notes
- Per §5.14 (lines 8175–8177): "ObjectRowComponent (one per common prefix or object) - folder rows → click sets prefix to `<currentPrefix><name>/` - object rows → click opens metadata side-panel; download via signed URL or admin endpoint".
- Two inputs: `kind: 'folder' | 'object'` and either `prefix: string` or `entry: { key, size, etag, lastModified, storageClass }`.
- Two outputs: `enterPrefix = new EventEmitter<string>()` and `selectObject = new EventEmitter<string>()`.

## Acceptance criteria
- [ ] Component is standalone.
- [ ] Folder row click emits the new prefix `<currentPrefix><name>/`.
- [ ] Object row click emits the object key.

## Test obligations
- Unit: N/A (component-test scope deferred)
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1241]

## References
- `docs/WHITEPAPER.md` §5.14 (lines 8175–8177)
