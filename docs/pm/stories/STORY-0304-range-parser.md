---
id: STORY-0304
title: Single-range HTTP Range header parser
epic: EPIC-04
status: done
size: XS
risk: low
---

## User story
As an S3 client, I want `Range: bytes=...` headers honored for single ranges (closed, open-ended, suffix), so that I can fetch a slice of an object; multi-range requests should return 416 in v1.

## Description
Implement `apps/backend/src/s3/object/range.ts` exporting `RangeSpec` and `parseRange(header: string, size: number): RangeSpec | null`. Accepted forms: `bytes=A-B` (closed), `bytes=A-` (open-ended), `bytes=-N` (suffix). Rejected: comma-separated multi-range (returns `'invalid'`), non-`bytes=` unit, malformed numerals, empty body. Closed-range `end` is clamped to `size - 1`. `start >= size` and zero/negative suffix against `size === 0` return `'invalid'`. Caller emits HTTP 416 with `Content-Range: bytes */<size>` on `'invalid'`.

## Acceptance criteria
- [ ] `parseRange('bytes=0-499', 1000)` returns `{ start: 0, end: 499 }`.
- [ ] `parseRange('bytes=500-', 1000)` returns `{ start: 500, end: 999 }`.
- [ ] `parseRange('bytes=-200', 1000)` returns `{ start: 800, end: 999 }`.
- [ ] `parseRange('bytes=999-2000', 1000)` returns `{ start: 999, end: 999 }` (end clamped).
- [ ] `parseRange('bytes=1000-', 1000)` returns `'invalid'`.
- [ ] `parseRange('bytes=0-100,200-300', 1000)` returns `'invalid'` (multi-range).
- [ ] `parseRange('items=0-99', 1000)` returns `'invalid'` (non-bytes unit).
- [ ] `parseRange('bytes=', 1000)` returns `'invalid'`.
- [ ] `nx test backend --testPathPattern=range.spec.ts` passes with the full validation table from §4.3.

## Tasks
- [TASK-0913] Implement parseRange and RangeSpec type per RFC 7233 §3.1 subset

## Test plan
- [TEST-0307] parseRange unit tests covering the §4.3 table

## Dependencies
- Blocks: [STORY-0303]
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.3 (lines 5631–5717)
- Interfaces produced: `parseRange`, `RangeSpec`
