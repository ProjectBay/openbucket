---
id: TASK-1875
title: Object Tags key/value editor with read-only user-metadata
story: STORY-0614
status: done
type: implementation
size: M
---

## Description
Add a Tags tab/section to the object detail sheet that reads and writes object tagging via the admin tagging endpoints (STORY-0612), rendered as editable key/value rows. The object's `userMetadata` is shown read-only in the same section. Saving round-trips through `putObjectTagging`; clearing removes tags.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-tags.component.ts` — new (standalone, OnPush key/value editor)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add a Tags tab to the detail sheet alongside Details/Versions)

## Implementation notes
- `ObjectMetaDto` already carries `tagging?: { [key: string]: string }` and `userMetadata?: { [key: string]: string }` (`libs/api-client/src/lib/model/object-meta-dto.ts`); the panel currently renders neither. Seed the editor from `meta.tagging` and render `meta.userMetadata` read-only.
- Editor model: `readonly rows = signal<{ key: string; value: string }[]>([])`; "Add tag" appends an empty row; each row has two `hlm-input` (`@openbucket/spartan-ui/input`) fields and a `lucideTrash2` remove button with `aria-label`. Validate non-empty/duplicate keys before save.
- Load tags via `ObjectsAdminService.getObjectTagging(name, path, ...)` (STORY-0612 / TASK-1861) or reuse `meta.tagging` from the already-fetched `getObject`; Save via `putObjectTagging(name, path, body, ...)`; a "Clear all" path calls `deleteObjectTagging(name, path, ...)`. Wrap save in `notify.promise(...)` (TASK-1800) so the toast transitions loading→success/error.
- `userMetadata` is read-only (S3 user metadata is set at PUT time, not editable via tagging) — render it in a separate `<dl>` labelled "Metadata (read-only)" with the empty state from TASK-1877 when absent.
- `OnPush`; `@for (r of rows(); track $index)`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Tags load from the object, edits persist via `putObjectTagging`, and re-opening the sheet shows the saved tags (round-trip).
- [ ] `userMetadata` renders read-only with no edit affordance; empty state shows when absent.
- [ ] Save uses `notify.promise` (loading→success/error); duplicate/empty keys are rejected before the request.

## Test obligations
- Unit: covered by [TEST-0614] (rows seed from tagging; save maps rows→body).
- E2E: covered by [TEST-0614] (manual/e2e: tags round-trip).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user E; feature-gap table — tagging UI absent).
- `libs/api-client/src/lib/model/object-meta-dto.ts` (`tagging`, `userMetadata`), `libs/api-client/src/lib/api/objects-admin.service.ts` (`getObjectTagging`/`putObjectTagging`/`deleteObjectTagging`, STORY-0612), `libs/ui/spartan/{input,button}`.
- Interfaces consumed: object tagging endpoints (STORY-0612), `notify` (TASK-1800).
