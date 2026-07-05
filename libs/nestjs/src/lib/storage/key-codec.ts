/**
 * Filesystem-safe encoding of S3 keys to path-mirror filenames.
 *
 * Pass-through:   A-Z a-z 0-9 - _ . ~
 * Preserved:      /   (S3 "folder" convention — keys form directory trees)
 * Encoded:        everything else, byte-wise as %XX (UTF-8 bytes)
 *
 * Special cases per segment (between '/' characters):
 *   - leading '.'   → %2E  (avoid Unix hidden files)
 *   - trailing '.'  → %2E  (Windows quirk)
 *   - trailing ' '  → %20  (Windows quirk)
 *   - segment length cap: 255 bytes — throws KeyTooLongError
 */

export class KeyTooLongError extends Error {
  override readonly name = 'KeyTooLongError';
  constructor(readonly segment: string, readonly maxBytes = 255) {
    super(`encoded key segment exceeds ${maxBytes} bytes`);
  }
}

const UNRESERVED = new Set<number>();
(() => {
  const ranges: [number, number][] = [
    [0x30, 0x39], // 0-9
    [0x41, 0x5a], // A-Z
    [0x61, 0x7a], // a-z
  ];
  for (const [lo, hi] of ranges) {
    for (let c = lo; c <= hi; c++) UNRESERVED.add(c);
  }
  for (const ch of '-_.~') UNRESERVED.add(ch.charCodeAt(0));
})();

const HEX = '0123456789ABCDEF';

/**
 * Per-segment byte cap. The encoded output can only grow (each byte maps to 1
 * or 3 output chars), so a raw segment longer than this can never encode to
 * <= 255 bytes and is rejected up front — this both preserves the existing
 * length semantics and gives the encode loop a provably-constant upper bound
 * (CWE-834, js/loop-bound-injection).
 */
const MAX_SEGMENT_BYTES = 255;

// Placeholder for an EMPTY key segment (from a trailing slash — an S3 "folder
// marker" like `photos/` — or a `//` in the key). Left as '' it would produce a
// path ending in (or containing a doubled) '/', which can't be a filename
// (`fs.rename` to `.../photos/` fails with ENOENT). `/` can never appear inside a
// segment (it's the separator), so `%2F` never collides with a real encoded
// segment; decodeSegment maps it back to '' so the key still round-trips.
const EMPTY_SEGMENT = '%2F';

function encodeByte(b: number): string {
  return '%' + HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
}

function encodeSegment(segment: string): string {
  if (segment.length === 0) return EMPTY_SEGMENT; // trailing/double slash → safe placeholder
  const bytes = Buffer.from(segment, 'utf8');
  // Bound the loop before entering it (js/loop-bound-injection): the encoded
  // form is never shorter than the raw bytes, so anything past this cap would
  // fail the post-encode 255-byte check anyway — reject it here so the loop
  // bound is a constant.
  if (bytes.length > MAX_SEGMENT_BYTES) {
    throw new KeyTooLongError(segment);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (UNRESERVED.has(b)) {
      out += String.fromCharCode(b);
    } else {
      out += encodeByte(b);
    }
  }

  // Leading dot becomes %2E so the directory entry is not a "hidden file"
  // on POSIX listings and so dotfile-skipping tooling doesn't miss it.
  if (out.startsWith('.')) {
    out = '%2E' + out.slice(1);
  }

  // Trailing dot or space: Windows can't host these as filenames. We're on
  // Linux in prod, but the encoding is forward-compatible.
  const last = out[out.length - 1];
  if (last === '.') {
    out = out.slice(0, -1) + '%2E';
  } else if (last === ' ') {
    out = out.slice(0, -1) + '%20';
  }

  if (Buffer.byteLength(out, 'utf8') > MAX_SEGMENT_BYTES) {
    throw new KeyTooLongError(segment);
  }
  return out;
}

/**
 * Encode a full key into a filesystem-safe relative path. The '/' character
 * is preserved as a path separator. Other characters are encoded per-segment.
 */
export function encodeKey(key: string): string {
  if (key.length === 0) {
    throw new Error('empty key is not encodable');
  }
  const segments = key.split('/');
  return segments.map(encodeSegment).join('/');
}

/**
 * Decode a path-mirror filename back to a raw key. Used only for diagnostics
 * and the orphan-blob scan — the hot path reads keys from SQLite, never from
 * disk. Tolerant of malformed input: invalid %XX sequences pass through.
 */
export function decodeKey(encoded: string): string {
  const segments = encoded.split('/');
  return segments.map(decodeSegment).join('/');
}

function decodeSegment(segment: string): string {
  if (segment.length === 0 || segment === EMPTY_SEGMENT) return '';
  const out: number[] = [];
  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);
    if (ch === 0x25 /* % */ && i + 2 < segment.length) {
      const hi = parseHex(segment.charCodeAt(i + 1));
      const lo = parseHex(segment.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out.push((hi << 4) | lo);
        i += 2;
        continue;
      }
    }
    out.push(ch);
  }
  return Buffer.from(out).toString('utf8');
}

function parseHex(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}
