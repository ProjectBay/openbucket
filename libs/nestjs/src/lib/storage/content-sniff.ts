/**
 * Zero-dependency magic-byte content-type sniffer (STORY-0803, TASK-2430).
 *
 * Maps the leading bytes of an object body to a MIME type so upload helpers can
 * trust what a file *is* rather than the caller-supplied `Content-Type`. Kept
 * in-house (no `file-type` dependency) to stay CommonJS-friendly and to bound the
 * byte window we inspect (DoS-safe): only a fixed `SNIFF_BYTES` prefix is ever
 * examined, all comparisons are fixed-length prefix compares (no regex
 * backtracking), and no allocation is proportional to the body size.
 *
 * `undefined` is a valid answer — the caller degrades to the declared type. The
 * table is intentionally limited to the upload-relevant set; it is not
 * exhaustive.
 */

/** Bytes to inspect. A fixed, small window — the caller peeks at most this many. */
export const SNIFF_BYTES = 4100;

/** Fixed byte-prefix signature (checked at `offset`). */
interface Signature {
  mime: string;
  offset: number;
  bytes: readonly number[];
}

/** ASCII string → byte array (for readable signature literals). */
function ascii(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

/**
 * True iff `head[offset..offset+bytes.length)` equals `bytes`. Bounds-checked —
 * never reads past `head.length`, so a short/truncated buffer is a graceful miss.
 */
function matchAt(head: Buffer, offset: number, bytes: readonly number[]): boolean {
  if (offset < 0 || offset + bytes.length > head.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

// Ordered longest/most-specific first so a shorter prefix can't shadow a longer
// one. Adding a type is a single row.
const SIGNATURES: readonly Signature[] = [
  { mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', offset: 0, bytes: ascii('GIF87a') },
  { mime: 'image/gif', offset: 0, bytes: ascii('GIF89a') },
  { mime: 'application/pdf', offset: 0, bytes: ascii('%PDF-') },
  { mime: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'image/tiff', offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }, // little-endian
  { mime: 'image/tiff', offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // big-endian
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'audio/mpeg', offset: 0, bytes: ascii('ID3') },
  { mime: 'application/gzip', offset: 0, bytes: [0x1f, 0x8b] },
  { mime: 'image/bmp', offset: 0, bytes: [0x42, 0x4d] },
];

const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const FTYP = ascii('ftyp');
const USTAR = ascii('ustar');
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const ASCII_WS = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);

/**
 * ISO Base Media File Format brands (bytes 8..12, after the `ftyp` box marker at
 * offset 4). Maps the major brand to its MIME type.
 */
function sniffFtyp(head: Buffer): string | undefined {
  if (!matchAt(head, 4, FTYP) || head.length < 12) return undefined;
  const brand = head.toString('latin1', 8, 12).trim().toLowerCase();
  switch (brand) {
    case 'avif':
    case 'avis':
      return 'image/avif';
    case 'heic':
    case 'heix':
    case 'heim':
    case 'heis':
    case 'hevc':
    case 'hevx':
    case 'mif1':
    case 'msf1':
      return 'image/heic';
    case 'isom':
    case 'iso2':
    case 'mp41':
    case 'mp42':
    case 'm4v':
    case 'm4a':
    case 'dash':
      return 'video/mp4';
    default:
      return undefined;
  }
}

/**
 * Detect leading textual active content so validation can *reject* it (see
 * TASK-2432): SVG/XML and HTML. Trims at most a UTF-8 BOM plus a bounded run of
 * ASCII whitespace, then does a bounded, case-insensitive prefix compare — no
 * backtracking, no scan proportional to body size.
 */
function sniffText(head: Buffer): string | undefined {
  let i = 0;
  if (matchAt(head, 0, UTF8_BOM)) i = 3;
  // Bound the whitespace skip so a huge run of leading spaces can't dominate.
  let skipped = 0;
  while (i < head.length && skipped < 64 && ASCII_WS.has(head[i])) {
    i++;
    skipped++;
  }
  if (i >= head.length) return undefined;
  const window = head.toString('latin1', i, Math.min(head.length, i + 64)).toLowerCase();
  if (window.startsWith('<svg')) return 'image/svg+xml';
  if (window.startsWith('<?xml')) return 'image/svg+xml';
  if (window.startsWith('<!doctype html')) return 'text/html';
  if (window.startsWith('<html')) return 'text/html';
  return undefined;
}

/**
 * Best-effort MIME type from magic bytes. Returns `undefined` when unrecognized
 * (caller falls back to the declared type). Never throws; never reads past
 * `head` (or past the `SNIFF_BYTES` window, whichever is smaller).
 */
export function sniffContentType(head: Buffer): string | undefined {
  if (!Buffer.isBuffer(head) || head.length === 0) return undefined;
  const h = head.length > SNIFF_BYTES ? head.subarray(0, SNIFF_BYTES) : head;

  // Container formats need multi-region checks, so run them first.
  if (matchAt(h, 0, RIFF) && matchAt(h, 8, WEBP)) return 'image/webp';
  const ftyp = sniffFtyp(h);
  if (ftyp) return ftyp;

  // Fixed byte-prefix signatures.
  for (const sig of SIGNATURES) {
    if (matchAt(h, sig.offset, sig.bytes)) return sig.mime;
  }

  // MP3 frame sync (11 set bits): FF Ex/Fx. Checked after the table so a JPEG
  // (FF D8 FF) or ID3-tagged MP3 wins first.
  if (h.length >= 2 && h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return 'audio/mpeg';

  // TAR: `ustar` magic at offset 257 — only when the head reaches that far.
  if (matchAt(h, 257, USTAR)) return 'application/x-tar';

  // Textual active content that must be detectable to reject (SVG/XML, HTML).
  return sniffText(h);
}
