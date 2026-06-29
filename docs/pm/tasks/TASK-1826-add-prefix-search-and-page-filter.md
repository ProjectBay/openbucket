---
id: TASK-1826
title: Add prefix-search HlmInput (+ `/` shortcut) and a client-side page filter
story: STORY-0605
status: done
type: implementation
size: M
---

## Description
Give operators two complementary ways to find objects: a server-side prefix jump (an `HlmInput` whose value becomes the listing `prefix`) and a cheap client-side filter that narrows the rows already on the current page. Pressing `/` anywhere on the screen focuses the search input. The server-jump re-lists from the chosen prefix; the client filter is a `computed` over the current `objects()`/`folders()` that never hits the network.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add search input, `/` shortcut, `filter` signal, filtered `computed`s)

## Implementation notes
- Import `HlmInputImports` from `@openbucket/spartan-ui/input` for the search box.
- Server-side jump: bind a search field to a handler that calls `void this.navigateTo(value)` (existing method — it sets `prefix`, resets the `stack`, and reloads via `listObjects(name, prefix, '/', marker, limit)`). Treat the typed text as a key prefix; the `prefix` arg of `listObjects` is the server filter.
- Client-side filter: add `readonly filter = signal('')` and derive `readonly visibleObjects = computed(() => { const q = this.filter().toLowerCase(); return this.objects().filter(o => o.key.toLowerCase().includes(q)); })` plus an equivalent `visibleFolders` over `folders()`. Render `visibleObjects()`/`visibleFolders()` in the `@for` rows instead of the raw signals.
- `/` shortcut: add a `@HostListener('document:keydown', ['$event'])` (or `host: { '(document:keydown)': '...' }`) that, when `event.key === '/'` and the active element is not already an input/textarea, calls `event.preventDefault()` and focuses the search input via a `@ViewChild`/`viewChild` element ref + `.nativeElement.focus()`.
- Keep the two concerns distinct: the client filter must NOT trigger `load()`; only the explicit prefix-jump re-lists.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23 for the frontend).
- [ ] Typing in the search box and submitting jumps to that server-side prefix (a new `listObjects` request with the typed `prefix`).
- [ ] The client filter narrows the visible rows of the current page without a network request (verified via the network panel).
- [ ] Pressing `/` while not focused in a field focuses the search input.

## Test obligations
- Unit: N/A (UI binding); the `computed` filter is exercised manually.
- E2E: covered by [TEST-0605] (prefix search jumps; filter narrows the page; `/` focuses).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604], [TASK-1825]

## References
- UX review 2026-06-22 (power-user F3 — no search; F-keyboard — `/` to focus search).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`navigateTo()`, `objects()`, `folders()`), `libs/api-client/src/lib/api/objects-admin.service.ts` (`listObjects` `prefix` arg), `libs/ui/spartan/input` (`HlmInputImports`).
