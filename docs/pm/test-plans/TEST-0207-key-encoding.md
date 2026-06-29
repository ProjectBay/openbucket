---
id: TEST-0207
title: Key encoding unit test (all §3.5.1 cases)
covers: [STORY-0207, TASK-0618, TASK-0619]
status: done
level: unit
---

## Goal
Verify `encodeKey` and `decodeKey` against every case enumerated in §3.5.1: ASCII pass-through, slash preservation, percent-encoding (including space, control chars, UTF-8 multi-byte sequences, emoji), leading-dot / trailing-dot / trailing-space rewrites, the 255-byte length cap, malformed-escape decode tolerance, and empty-key rejection.

## Setup
- No setup — pure-function module.

## Cases
1. `encodeKey('hello-world_123.txt')` returns `'hello-world_123.txt'`.
2. `encodeKey('a-b_c.d~e')` returns `'a-b_c.d~e'`.
3. `encodeKey('photos/2026/may.jpg')` returns `'photos/2026/may.jpg'`.
4. `encodeKey('my file.txt')` returns `'my%20file.txt'`.
5. `encodeKey('a?b&c=d')` returns `'a%3Fb%26c%3Dd'`.
6. `encodeKey('cafeé.txt')` returns `'cafe%C3%A9.txt'`.
7. `encodeKey('emoji\u{1F600}')` returns `'emoji%F0%9F%98%80'`.
8. `encodeKey('a\nb\tc')` returns `'a%0Ab%09c'`.
9. `encodeKey('.htaccess')` returns `'%2Ehtaccess'`.
10. `encodeKey('a/.b/c')` returns `'a/%2Eb/c'`.
11. `encodeKey('foo.')` returns `'foo%2E'`.
12. `encodeKey('foo ')` returns `'foo%20'`.
13. `encodeKey('.hidden.')` returns `'%2Ehidden%2E'`.
14. `encodeKey('\u{1F600}'.repeat(90))` throws `KeyTooLongError`.
15. `encodeKey('a'.repeat(255))` returns the same 255-byte string (exact cap accepted).
16. `encodeKey('')` throws with message `/empty key/`.
17. `encodeKey('a//b')` returns `'a//b'`; `decodeKey('a//b')` returns `'a//b'`.
18. `decodeKey('a%ZZ')` returns `'a%ZZ'`; `decodeKey('a%')` returns `'a%'`.
19. Round-trip via `decodeKey(encodeKey(raw)) === raw` for: `'simple.txt'`, `'photos/2026/05/20/cat.jpg'`, `'my file with spaces.bin'`, `'a?b&c=d'`, `'cafeé.txt'`, `'a\nb'`, `'.htaccess'`, `'trailing.'`, `'trailing '`, `'\u{1F4A9}\u{1F600}.bin'`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=key-codec.spec.ts`

## Pass criteria
- [x] All 19 cases pass (`apps/openbucket-backend/src/storage/key-codec.spec.ts`); backend suite 112/112.

## References
- `docs/WHITEPAPER.md` §3.5 (lines 3877–4125), §3.5.1 (lines 4007–4122)
