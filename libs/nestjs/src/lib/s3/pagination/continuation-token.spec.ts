import { InvalidArgumentError } from '../errors/s3-error';
import { ContinuationToken, ListCursor } from './continuation-token';

/** TEST-0134 — ContinuationToken (HMAC-sealed) unit. */
function freshToken(): ContinuationToken {
  const t = new ContinuationToken();
  t.onModuleInit(); // derive the per-process secret
  return t;
}

const cursor: ListCursor = {
  b: 'my-bucket',
  afterKey: 'photos/2026/sunset.jpg',
  delimiter: '/',
  prefix: 'photos/',
  v: 1,
};

describe('ContinuationToken (TEST-0134)', () => {
  it('round-trips a cursor for the issuing bucket', () => {
    const t = freshToken();
    const token = t.encode(cursor);
    expect(typeof token).toBe('string');
    expect(t.decode(token, 'my-bucket')).toEqual(cursor);
  });

  it('rejects a token presented for a different bucket', () => {
    const t = freshToken();
    const token = t.encode(cursor);
    expect(() => t.decode(token, 'other-bucket')).toThrow(InvalidArgumentError);
  });

  it('rejects a tampered payload (HMAC mismatch)', () => {
    const t = freshToken();
    const token = t.encode(cursor);
    // Flip a byte in the middle of the base64url token.
    const bytes = Buffer.from(token, 'base64url');
    bytes[5] = bytes[5] ^ 0xff;
    const tampered = bytes.toString('base64url');
    expect(() => t.decode(tampered, 'my-bucket')).toThrow(InvalidArgumentError);
  });

  it('rejects a token from a different process (different secret)', () => {
    const a = freshToken();
    const b = freshToken();
    const token = a.encode(cursor);
    expect(() => b.decode(token, 'my-bucket')).toThrow(InvalidArgumentError);
  });

  it('rejects garbage and too-short tokens', () => {
    const t = freshToken();
    expect(() => t.decode('!!!not-base64!!!', 'my-bucket')).toThrow(InvalidArgumentError);
    expect(() => t.decode('AAAA', 'my-bucket')).toThrow(InvalidArgumentError);
  });
});
