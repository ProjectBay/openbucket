---
id: TASK-1825
title: Add a page-size HlmSelect bound to the listObjects `limit`
story: STORY-0605
status: done
type: implementation
size: S
---

## Description
Replace the hardcoded `limit=100` in the object browser's `load()` with an operator-chosen page size. Add an `HlmSelect` offering 25/50/100/250/1000 (default 100) whose value feeds the `limit` positional argument of `ObjectsAdminService.listObjects`. Changing the page size re-lists the current prefix from the start (reset the marker stack) so paging stays consistent.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add `pageSize` signal + select control; replace the `100` literal)

## Implementation notes
- The generated client takes positional query params: `listObjects(name, prefix?, delimiter?, marker?, limit?)` — see `libs/api-client/src/lib/api/objects-admin.service.ts`. Today `load()` calls `this.objects$.listObjects(this.bucket(), top.prefix, '/', top.marker, 100)`; replace the trailing `100` with `this.pageSize()`.
- Add `readonly pageSize = signal(100);` and a `readonly pageSizes = [25, 50, 100, 250, 1000] as const;`.
- Import `HlmSelectImports` from `@openbucket/spartan-ui/select` (exports `HlmSelect, HlmSelectTrigger, HlmSelectValue, HlmSelectContent, HlmSelectOption, ...`). Bind `[(ngModel)]` / `(valueChange)` to a handler `setPageSize(n: number)` that calls `this.pageSize.set(n)` then `void this.navigateTo(this.prefix())` (which resets `stack` to a single root page and reloads). Add `FormsModule` to `imports` if using `ngModel`.
- Keep `delimiter` as `'/'` so common prefixes still surface as folders; only `limit` changes.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (run frontend tooling on Node 23).
- [ ] The select renders the five options with 100 pre-selected; choosing a different value re-lists with that `limit` and the page returns at most that many `contents` rows.
- [ ] Changing page size resets paging (the marker stack returns to a single page; Back is disabled).

## Test obligations
- Unit: N/A (UI binding).
- E2E: covered by [TEST-0605] (change page size, row count reflects the chosen limit).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604]

## References
- UX review 2026-06-22 (power-user B — page-size control; F8 — hardcoded `limit=100`).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`load()`, `navigateTo()`, `stack`), `libs/api-client/src/lib/api/objects-admin.service.ts` (`listObjects` positional `limit`), `libs/ui/spartan/select` (`HlmSelectImports`).
