---
id: TASK-0913
title: Implement parseRange and RangeSpec
story: STORY-0304
status: done
type: implementation
size: S
---

## Description
Implement `apps/backend/src/s3/object/range.ts` exporting `RangeSpec = { start: number; end: number } | 'invalid'` and `parseRange(header: string, size: number): RangeSpec | null` per RFC 7233 §3.1, restricted to the `bytes` unit and a single range.

## Files to create / modify
- `apps/backend/src/s3/object/range.ts` — new

## Implementation notes
- Algorithm verbatim per §4.3:
  - Trim header.
  - Reject if not `startsWith('bytes=')` → `'invalid'`.
  - Slice off `bytes=`; if comma present → `'invalid'` (multi-range, v1).
  - Find `-`; if absent → `'invalid'`.
  - Split into `startStr` / `endStr`.
  - Branches:
    - `startStr === '' && endStr !== ''` → suffix: `suffix = Number(endStr)`; require integer > 0; require `size > 0`; `start = max(0, size - suffix)`, `end = size - 1`.
    - `startStr !== '' && endStr === ''` → open-ended: `start = Number(startStr)`, integer ≥ 0, `start < size`; `end = size - 1`.
    - `startStr !== '' && endStr !== ''` → closed: integer + non-negative + `start <= end` + `start < size`; if `end >= size` clamp `end = size - 1`.
    - else → `'invalid'`.

## Acceptance criteria
- [ ] The validation table from §4.3 is reproduced exactly by the implementation (asserted by [TEST-0307]).
- [ ] Function returns `null` only when its return type allows — in practice the table only produces `{ start, end }` or `'invalid'`; `null` is reserved for the `RangeSpec | null` shape.

## Test obligations
- Unit: covered by [TEST-0307]
- E2E: covered by [TEST-0306]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.3 (lines 5638–5717)
