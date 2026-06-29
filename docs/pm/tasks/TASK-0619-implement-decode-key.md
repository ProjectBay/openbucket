---
id: TASK-0619
title: Implement `decodeSegment` and `decodeKey`
story: STORY-0207
status: done
type: implementation
size: XS
---

## Description
Implement the decoder half of the key codec, tolerant of malformed `%XX` sequences (pass-through). Used by the orphan-blob scan and diagnostics — never on the hot read path.

## Files to create / modify
- `apps/openbucket-backend/src/storage/key-codec.ts` — modify (append decode functions to TASK-0618)

## Implementation notes
- `decodeKey(encoded): string` — `return encoded.split('/').map(decodeSegment).join('/');`.
- `decodeSegment(segment)`:
  - Empty returns `''`.
  - Iterate by code unit; on `%` followed by two valid hex digits, push the byte and advance `i += 2`; on invalid hex, fall through (pass `%` and digits literally).
  - Collect into a `number[]`; return `Buffer.from(out).toString('utf8');`.
- `parseHex(code)` helper handling `0-9`, `A-F`, `a-f`; returns `-1` otherwise.
- Tolerance is explicit: `decodeKey('a%ZZ')` returns `'a%ZZ'`; `decodeKey('a%')` returns `'a%'`.

## Acceptance criteria
- [ ] Every encoded value produced by `encodeKey` round-trips through `decodeKey` back to the original raw key.
- [ ] `decodeKey('a%ZZ') === 'a%ZZ'`; `decodeKey('a%') === 'a%'`.
- [ ] `decodeKey('a//b') === 'a//b'`.

## Test obligations
- Unit: covered by [TEST-0207]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0618]

## References
- `docs/WHITEPAPER.md` §3.5 (lines 3970–4005)
