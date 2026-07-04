import sharp from 'sharp';

import { imageInfo } from './image-info';
import { SNIFF_BYTES } from './content-sniff';

const WIDTH = 13;
const HEIGHT = 7;

/** A solid raw RGB image at the fixed test dimensions. */
function raw(): sharp.Sharp {
  return sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 10, g: 20, b: 30 } },
  });
}

describe('imageInfo (TASK-2431)', () => {
  let png: Buffer;
  let jpeg: Buffer;
  let webp: Buffer;
  // A hand-rolled 10x6 GIF87a (image-size reads the logical screen descriptor).
  const gif = Buffer.from('GIF87a' + '\x0a\x00\x06\x00' + '\x00\x00\x00', 'latin1');

  beforeAll(async () => {
    png = await raw().png().toBuffer();
    jpeg = await raw().jpeg().toBuffer();
    webp = await raw().webp().toBuffer();
  });

  it('returns the exact width/height for a PNG', () => {
    expect(imageInfo(png)).toEqual({ width: WIDTH, height: HEIGHT, type: 'png' });
  });

  it('returns the exact width/height for a JPEG', () => {
    const info = imageInfo(jpeg);
    expect(info).toMatchObject({ width: WIDTH, height: HEIGHT });
  });

  it('returns the exact width/height for a WebP', () => {
    const info = imageInfo(webp);
    expect(info).toMatchObject({ width: WIDTH, height: HEIGHT });
  });

  it('returns the width/height for a GIF', () => {
    expect(imageInfo(gif)).toMatchObject({ width: 10, height: 6, type: 'gif' });
  });

  it('works when fed only the bounded head window (SNIFF_BYTES)', () => {
    expect(imageInfo(png.subarray(0, SNIFF_BYTES))).toMatchObject({ width: WIDTH, height: HEIGHT });
  });

  it('returns undefined for a non-image buffer without throwing', () => {
    expect(imageInfo(Buffer.from('%PDF-1.7\n%mixed'))).toBeUndefined();
    expect(imageInfo(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBeUndefined();
  });

  it('returns undefined for a 4-byte truncated image head without throwing', () => {
    expect(() => imageInfo(png.subarray(0, 4))).not.toThrow();
    expect(imageInfo(png.subarray(0, 4))).toBeUndefined();
  });

  it('returns undefined for an empty buffer', () => {
    expect(imageInfo(Buffer.alloc(0))).toBeUndefined();
  });
});
