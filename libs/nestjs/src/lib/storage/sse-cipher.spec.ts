import * as crypto from 'node:crypto';

import {
  alignedStart,
  createRangeDecipher,
  decryptBuffer,
  decryptRange,
  encryptBuffer,
  generateIv,
  rangeSkip,
  SSE_KEY_BYTES,
} from './sse-cipher';

const key = crypto.randomBytes(SSE_KEY_BYTES);

describe('sse-cipher (STORY-0122)', () => {
  it('round-trips a full buffer and is length-preserving', () => {
    const iv = generateIv();
    const pt = crypto.randomBytes(10_000);
    const ct = encryptBuffer(key, iv, pt);
    expect(ct.length).toBe(pt.length);
    expect(ct.equals(pt)).toBe(false);
    expect(decryptBuffer(key, iv, ct).equals(pt)).toBe(true);
  });

  it('decryptRange matches the plaintext slice across aligned/unaligned ranges', () => {
    const iv = generateIv();
    const pt = crypto.randomBytes(5000);
    const ct = encryptBuffer(key, iv, pt);
    const ranges: Array<[number, number]> = [
      [0, 0],
      [0, 15],
      [0, 16],
      [1, 1],
      [15, 16],
      [16, 31],
      [17, 100],
      [100, 4999],
      [0, 4999],
      [4999, 4999],
      [1234, 2345],
      [4096, 4096],
    ];
    for (const [start, end] of ranges) {
      const cipherFromAligned = ct.subarray(alignedStart(start), end + 1);
      const got = decryptRange(key, iv, cipherFromAligned, start, end);
      expect(got.equals(pt.subarray(start, end + 1))).toBe(true);
    }
  });

  it('handles large offsets with counter carry (IV all 0xFF)', () => {
    const iv = Buffer.alloc(16, 0xff); // forces big-endian carry on increment
    const pt = crypto.randomBytes(8192);
    const ct = encryptBuffer(key, iv, pt);
    const start = 5000;
    const end = 6000;
    const got = decryptRange(key, iv, ct.subarray(alignedStart(start), end + 1), start, end);
    expect(got.equals(pt.subarray(start, end + 1))).toBe(true);
  });

  it('createRangeDecipher (streaming) lines up with the plaintext slice', () => {
    const iv = generateIv();
    const pt = crypto.randomBytes(3000);
    const ct = encryptBuffer(key, iv, pt);
    const start = 17;
    const end = 2500;
    const d = createRangeDecipher(key, iv, start);
    const plainFromAligned = Buffer.concat([
      d.update(ct.subarray(alignedStart(start), end + 1)),
      d.final(),
    ]);
    const got = plainFromAligned.subarray(rangeSkip(start), rangeSkip(start) + (end - start + 1));
    expect(got.equals(pt.subarray(start, end + 1))).toBe(true);
  });

  it('a wrong key fails to recover the plaintext', () => {
    const iv = generateIv();
    const pt = crypto.randomBytes(512);
    const ct = encryptBuffer(key, iv, pt);
    const wrong = crypto.randomBytes(SSE_KEY_BYTES);
    expect(decryptBuffer(wrong, iv, ct).equals(pt)).toBe(false);
  });
});
