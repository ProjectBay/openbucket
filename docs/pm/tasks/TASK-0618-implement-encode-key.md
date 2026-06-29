---
id: TASK-0618
title: Implement `KeyTooLongError`, `encodeSegment`, `encodeKey`
story: STORY-0207
status: done
type: implementation
size: S
---

## Description
Implement the encoding side of the key codec: per-segment encoding with the unreserved-character pass-through, percent-encoding of everything else byte-wise, the leading-dot / trailing-dot / trailing-space rewrites, and the 255-byte segment cap that throws `KeyTooLongError`.

## Files to create / modify
- `apps/openbucket-backend/src/storage/key-codec.ts` — new (encode half; decode added in TASK-0619)

## Implementation notes
- `class KeyTooLongError extends Error { override readonly name = 'KeyTooLongError'; constructor(readonly segment: string, readonly maxBytes = 255) { super(`encoded key segment exceeds ${maxBytes} bytes`); } }`.
- Build `UNRESERVED` set once at module load: ranges `[0x30, 0x39]` (0-9), `[0x41, 0x5A]` (A-Z), `[0x61, 0x7A]` (a-z), plus the chars `- _ . ~`.
- `const HEX = '0123456789ABCDEF';`.
- `encodeByte(b) → '%' + HEX[(b >> 4) & 0xf] + HEX[b & 0xf];`.
- `encodeSegment(segment)`:
  - Empty segment returns `''` (preserves double-slash).
  - Iterate over UTF-8 bytes (`Buffer.from(segment, 'utf8')`); pass-through if in `UNRESERVED`, else `encodeByte`.
  - Leading dot rewrite: `if (out.startsWith('.')) out = '%2E' + out.slice(1);`.
  - Trailing dot: `if (last === '.') out = out.slice(0, -1) + '%2E';`.
  - Trailing space: `else if (last === ' ') out = out.slice(0, -1) + '%20';`.
  - Length cap: `if (Buffer.byteLength(out, 'utf8') > 255) throw new KeyTooLongError(segment);`.
- `encodeKey(key)`:
  - `if (key.length === 0) throw new Error('empty key is not encodable');`.
  - `return key.split('/').map(encodeSegment).join('/');`.

## Acceptance criteria
- [ ] All §3.5.1 pass-through, percent-encoding, hidden/quirky-segment, and length-cap cases produce the expected output.
- [ ] `encodeKey('emoji\u{1F600}')` returns `'emoji%F0%9F%98%80'`.
- [ ] `encodeKey('')` throws.

## Test obligations
- Unit: covered by [TEST-0207]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §3.5 (lines 3877–3968)
