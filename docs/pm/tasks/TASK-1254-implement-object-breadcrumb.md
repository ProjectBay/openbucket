---
id: TASK-1254
title: Implement ObjectBreadcrumbComponent
story: STORY-0418
status: done
type: implementation
size: XS
---

## Description
Renders the prefix path as a breadcrumb: `bucket > a > b > c`. Emits a navigate event with the truncated prefix when a segment is clicked.

## Files to create / modify
- `apps/frontend/src/app/objects/object-breadcrumb.component.ts` — new

## Implementation notes
- Per §5.14 (line 8172): "ObjectBreadcrumbComponent // prefix path: bucket > a > b > c".
- Standalone component with `@Input({ required: true }) bucket: string` and `@Input({ required: true }) prefix: string` and `@Output() navigate = new EventEmitter<string>()`.
- Splits `prefix` on `/`, drops the empty trailing segment, renders one anchor per segment.

## Acceptance criteria
- [ ] Empty prefix renders only the bucket name.
- [ ] `prefix = 'a/b/c/'` renders `bucket > a > b > c` with three clickable links.
- [ ] Clicking the second segment emits `'a/b/'`.

## Test obligations
- Unit: N/A (component-test scope deferred)
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1241]

## References
- `docs/WHITEPAPER.md` §5.14 (lines 8170–8175)
