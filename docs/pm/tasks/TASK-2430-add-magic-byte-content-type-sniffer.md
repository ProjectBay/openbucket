---
id: TASK-2430
title: Add a zero-dependency magic-byte content-type sniffer
story: STORY-0803
status: backlog
type: implementation
size: S
---

## Description
Add a small, self-contained magic-byte content-type sniffer that maps the leading
bytes of an object body to a MIME type, so upload helpers can trust what a file
*is* rather than the caller-supplied `Content-Type`. This is the foundation the
validation ([TASK-2432]) and `uploadFrom` ([TASK-2433]) tasks build on. Kept
in-house (no `file-type` dependency) to stay CommonJS-friendly and to bound the
byte window we inspect (DoS-safe).

## Files to create / modify
- `libs/nestjs/src/lib/storage/content-sniff.ts` — new. Pure function + signature table.
- `libs/nestjs/src/lib/storage/content-sniff.spec.ts` — new. Table-driven unit tests.

## Implementation notes
- Public API:
  ```ts
  /** Bytes to inspect. A fixed, small window — the caller peeks at most this many. */
  export const SNIFF_BYTES = 4100;

  /**
   * Best-effort MIME type from magic bytes. Returns undefined when unrecognized
   * (caller falls back to the declared type). Never throws; never reads past `head`.
   */
  export function sniffContentType(head: Buffer): string | undefined;
  ```
- Cover the common upload set with byte-prefix signatures (checked longest/most-specific first):
  - Images: `image/jpeg` (`FF D8 FF`), `image/png` (`89 50 4E 47 0D 0A 1A 0A`),
    `image/gif` (`GIF87a`/`GIF89a`), `image/webp` (`RIFF`....`WEBP`),
    `image/bmp` (`BM`), `image/tiff` (`49 49 2A 00` / `4D 4D 00 2A`),
    `image/avif`/`image/heic` (ISO-BMFF `ftyp` brand at offset 4: `avif`/`heic`/`mif1`).
  - Docs/archives: `application/pdf` (`%PDF-`), `application/zip` (`PK\x03\x04`),
    `application/gzip` (`1F 8B`), `application/x-tar` (`ustar` at offset 257 — only
    if `head` is long enough).
  - Media: `video/mp4` (ISO-BMFF `ftyp` brand `isom`/`mp4`/`M4V`), `audio/mpeg`
    (`ID3` or `FF Ex` frame sync).
  - Text/active content that must be *detectable to reject* (see [TASK-2432]):
    `image/svg+xml` (leading `<?xml`/`<svg` after optional BOM/whitespace),
    `text/html` (leading `<!doctype html`/`<html` case-insensitively, after trim).
- Signatures live in a single ordered `const SIGNATURES` table (`{ mime, offset, bytes }`
  or a small matcher fn for the RIFF/ftyp container cases) so adding a type is one row.
- Match against `head.subarray(0, SNIFF_BYTES)` only; treat a short buffer gracefully
  (bounds-check every offset — never read past `head.length`).
- Security / DoS: fixed inspection window (`SNIFF_BYTES`), no regex backtracking on
  large inputs (only fixed-length prefix compares; the HTML/SVG textual check trims at
  most a few leading whitespace/BOM bytes then does a bounded prefix compare). No
  allocation proportional to body size. Pure and synchronous.
- Do not attempt to be exhaustive — `undefined` is a valid answer and the helper
  degrades to the declared type. Keep the table to the upload-relevant set above.

## Acceptance criteria
- [ ] `sniffContentType` returns the correct MIME for a fixture of each supported type.
- [ ] Returns `undefined` for random/unknown bytes and for an empty buffer without throwing.
- [ ] Never reads past `head.length` (verified with truncated 2-byte and 8-byte inputs).
- [ ] `sniffContentType(Buffer.from('<svg xmlns=...'))` returns `image/svg+xml` and a
  leading-`<html>` buffer returns `text/html` (so [TASK-2432] can reject active content).
- [ ] `nx test nestjs --testPathPattern=content-sniff` passes.

## Test obligations
- Unit: covered by [TEST-0803] (sniffer case group).
- E2E: N/A — pure function.
- Conformance: N/A.

## Dependencies
- Blocked by: none.

## References
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `ACTIVE_CONTENT_TYPES`
  (`text/html`, `application/xhtml+xml`, `image/svg+xml`) that this sniffer must be
  able to detect so validation can reject them.
- Rejected alternative: `file-type` (ESM-only in current majors; would force the CJS
  library build through a dynamic `import()` and pulls a large signature set we don't need).
