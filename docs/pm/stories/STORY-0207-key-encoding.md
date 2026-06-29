---
id: STORY-0207
title: Filesystem-safe key encoding (`encodeKey`/`decodeKey`)
epic: EPIC-03
status: done
size: S
risk: medium
---

## User story
As a developer, I want deterministic, lossless percent-encoding/decoding of S3 keys at the filesystem boundary, so that arbitrary UTF-8 keys (including `/`, leading dots, trailing dots, trailing spaces, control chars, emoji) can be safely materialised as path-mirror filenames without truncation or collision while raw keys remain in SQLite.

## Description
Implement `encodeKey(key: string): string`, `decodeKey(encoded: string): string`, and the `KeyTooLongError` class exactly per §3.5. Pass-through: `A-Z a-z 0-9 - _ . ~`. Preserved: `/` as path separator. Special per-segment rules: leading `.` → `%2E`, trailing `.` → `%2E`, trailing ` ` → `%20`. Segment length cap: 255 bytes — throws `KeyTooLongError`. Encoder operates on UTF-8 bytes; decoder is tolerant of malformed `%XX` (pass-through). Empty key throws.

## Acceptance criteria
- [x] `encodeKey('hello-world_123.txt')` returns `'hello-world_123.txt'`.
- [x] `encodeKey('photos/2026/may.jpg')` preserves the `/` separators.
- [x] `encodeKey('my file.txt')` returns `'my%20file.txt'`.
- [x] `encodeKey('.htaccess')` returns `'%2Ehtaccess'`; `encodeKey('a/.b/c')` returns `'a/%2Eb/c'`.
- [x] `encodeKey('foo.')` returns `'foo%2E'`; `encodeKey('foo ')` returns `'foo%20'`.
- [x] `encodeKey('cafeé.txt')` returns `'cafe%C3%A9.txt'`; emoji encode byte-wise per UTF-8.
- [x] `encodeKey('\u{1F600}'.repeat(90))` throws `KeyTooLongError`.
- [x] `encodeKey('')` throws.
- [x] `decodeKey('a%ZZ')` returns `'a%ZZ'`; `decodeKey('a%')` returns `'a%'`.
- [x] Every test case enumerated in §3.5.1 round-trips correctly (TEST-0207).

## Tasks
- [TASK-0618] Implement `KeyTooLongError`, `encodeSegment`, `encodeKey`
- [TASK-0619] Implement `decodeSegment`, `decodeKey`

## Test plan
- [TEST-0207] Key encoding unit test (all §3.5.1 cases)

## Dependencies
- Blocks: [STORY-0208], [STORY-0210]
- Blocked by: _none_ (pure function; no DB dependency)

## References
- `docs/WHITEPAPER.md` §3.5 (lines 3877–4125)
- Interfaces produced: `encodeKey`, `decodeKey`, `KeyTooLongError`
