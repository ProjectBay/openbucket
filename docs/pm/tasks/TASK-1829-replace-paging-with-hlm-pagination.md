---
id: TASK-1829
title: Replace back/next buttons with HlmPagination over the marker stack
story: STORY-0605
status: done
type: implementation
size: S
---

## Description
Swap the ad-hoc `← Back` / `Next →` bordered buttons for the design-system `HlmPagination`, driven by the existing in-memory `(prefix, marker)` stack. Previous maps to `back()` (pop the stack) and Next maps to `nextPage()` (push the current `nextMarker`); both stay disabled at their boundaries exactly as today.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (replace the two `<button>`s with `HlmPagination` markup)

## Implementation notes
- Import `HlmPaginationImports` from `@openbucket/spartan-ui/pagination` (`HlmPagination, HlmPaginationContent, HlmPaginationItem, HlmPaginationLink, HlmPaginationPrevious, HlmPaginationNext, HlmPaginationEllipsis, ...`).
- Marker-based listings have no page numbers, so use the Previous/Next links only (no numbered `HlmNumberedPagination`). Previous → `(click)="back()"`, disabled when `stack.length <= 1`; Next → `(click)="nextPage()"`, disabled when `!nextMarker()` — mirror the existing `[disabled]` conditions.
- Keep the `Loading…` indicator next to the pager (existing `@if (loading())`).
- Do not change the `stack`/`nextMarker`/`load()` logic; this is purely the rendering swap.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Prev/Next render via `HlmPagination`; Prev is disabled on the first page, Next is disabled when the response is not truncated.
- [ ] Clicking Next advances using the response `nextMarker`; clicking Prev returns to the prior page.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0605] (paging forward/back through a multi-page bucket).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604], [TASK-1825]

## References
- UX review 2026-06-22 (power-user B — pager affordance; design — replace ad-hoc buttons).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`back()`, `nextPage()`, `nextMarker()`, `stack`), `libs/ui/spartan/pagination` (`HlmPaginationImports`).
