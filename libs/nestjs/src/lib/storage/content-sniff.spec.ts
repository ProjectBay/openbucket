import { sniffContentType, SNIFF_BYTES } from './content-sniff';

/** Build an ISO-BMFF head: [size][ftyp][major brand]. */
function ftypHead(brand: string): Buffer {
  const b = Buffer.alloc(16, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(brand.padEnd(4, ' ').slice(0, 4), 8, 'latin1');
  return b;
}

describe('sniffContentType (TASK-2430)', () => {
  const cases: Array<[string, Buffer, string]> = [
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), 'image/png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg'],
    ['gif87', Buffer.from('GIF87a....', 'latin1'), 'image/gif'],
    ['gif89', Buffer.from('GIF89a....', 'latin1'), 'image/gif'],
    ['bmp', Buffer.from('BM....', 'latin1'), 'image/bmp'],
    ['tiff-le', Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08]), 'image/tiff'],
    ['tiff-be', Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x08]), 'image/tiff'],
    ['pdf', Buffer.from('%PDF-1.7\n', 'latin1'), 'application/pdf'],
    ['zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]), 'application/zip'],
    ['gzip', Buffer.from([0x1f, 0x8b, 0x08, 0x00]), 'application/gzip'],
    ['mp3-id3', Buffer.from('ID3\x04\x00', 'latin1'), 'audio/mpeg'],
    ['mp3-sync', Buffer.from([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg'],
  ];

  it.each(cases)('detects %s', (_name, buf, mime) => {
    expect(sniffContentType(buf)).toBe(mime);
  });

  it('detects webp (RIFF ... WEBP)', () => {
    const b = Buffer.alloc(16, 0);
    b.write('RIFF', 0, 'latin1');
    b.write('WEBP', 8, 'latin1');
    expect(sniffContentType(b)).toBe('image/webp');
  });

  it('detects ISO-BMFF brands (avif/heic/mp4)', () => {
    expect(sniffContentType(ftypHead('avif'))).toBe('image/avif');
    expect(sniffContentType(ftypHead('heic'))).toBe('image/heic');
    expect(sniffContentType(ftypHead('mif1'))).toBe('image/heic');
    expect(sniffContentType(ftypHead('isom'))).toBe('video/mp4');
    expect(sniffContentType(ftypHead('M4V '))).toBe('video/mp4');
  });

  it('detects tar (ustar at offset 257) only when the head is long enough', () => {
    const tar = Buffer.alloc(300, 0);
    tar.write('ustar', 257, 'latin1');
    expect(sniffContentType(tar)).toBe('application/x-tar');
    // Too short to reach the ustar magic → not a false positive.
    expect(sniffContentType(Buffer.alloc(100, 0))).toBeUndefined();
  });

  it('detects SVG/XML as active content (so TASK-2432 can reject it)', () => {
    expect(sniffContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml',
    );
    expect(sniffContentType(Buffer.from('  \n<?xml version="1.0"?><svg/>'))).toBe('image/svg+xml');
    // Leading UTF-8 BOM is tolerated before the tag.
    expect(sniffContentType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<svg>')]))).toBe(
      'image/svg+xml',
    );
  });

  it('detects HTML as active content (case-insensitive, after whitespace)', () => {
    expect(sniffContentType(Buffer.from('<!DOCTYPE html><html></html>'))).toBe('text/html');
    expect(sniffContentType(Buffer.from('\n\t <HTML>'))).toBe('text/html');
  });

  it('returns undefined for unknown/random bytes and an empty buffer', () => {
    expect(sniffContentType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeUndefined();
    expect(sniffContentType(Buffer.from('just some plain text here'))).toBeUndefined();
    expect(sniffContentType(Buffer.alloc(0))).toBeUndefined();
  });

  it('never reads past head.length on truncated inputs (no throw)', () => {
    expect(() => sniffContentType(Buffer.from([0x89, 0x50]))).not.toThrow();
    expect(sniffContentType(Buffer.from([0x89, 0x50]))).toBeUndefined(); // partial PNG magic
    expect(sniffContentType(Buffer.from([0xff, 0xd8]))).toBeUndefined(); // partial JPEG magic
    // 8-byte truncated ftyp (marker present, brand missing) → graceful miss.
    const shortFtyp = Buffer.alloc(8, 0);
    shortFtyp.write('ftyp', 4, 'latin1');
    expect(sniffContentType(shortFtyp)).toBeUndefined();
  });

  it('only inspects the bounded SNIFF_BYTES window', () => {
    // A ustar magic pushed past the window must NOT be found.
    const big = Buffer.alloc(SNIFF_BYTES + 400, 0);
    big.write('ustar', SNIFF_BYTES + 257, 'latin1');
    expect(sniffContentType(big)).toBeUndefined();
  });
});
