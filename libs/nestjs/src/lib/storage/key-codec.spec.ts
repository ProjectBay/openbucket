import { decodeKey, encodeKey, KeyTooLongError } from './key-codec';

/**
 * TEST-0207 — all 19 cases enumerated in §3.5.1. Pure-function module; no setup.
 */
describe('encodeKey / decodeKey', () => {
  const roundtrip = (raw: string) => {
    const encoded = encodeKey(raw);
    expect(decodeKey(encoded)).toBe(raw);
  };

  describe('pass-through', () => {
    it('ASCII alphanumerics are unchanged', () => {
      expect(encodeKey('hello-world_123.txt')).toBe('hello-world_123.txt');
    });

    it('unreserved RFC3986 chars survive', () => {
      expect(encodeKey('a-b_c.d~e')).toBe('a-b_c.d~e');
    });

    it('preserves / as path separator', () => {
      expect(encodeKey('photos/2026/may.jpg')).toBe('photos/2026/may.jpg');
    });
  });

  describe('percent-encoding', () => {
    it('encodes space as %20', () => {
      expect(encodeKey('my file.txt')).toBe('my%20file.txt');
    });

    it('encodes question mark and ampersand', () => {
      expect(encodeKey('a?b&c=d')).toBe('a%3Fb%26c%3Dd');
    });

    it('encodes UTF-8 multi-byte sequences byte-wise', () => {
      // U+00E9 = 0xC3 0xA9 ; U+1F600 = 0xF0 0x9F 0x98 0x80
      expect(encodeKey('cafeé.txt')).toBe('cafe%C3%A9.txt');
      expect(encodeKey('emoji\u{1F600}')).toBe('emoji%F0%9F%98%80');
    });

    it('encodes control characters', () => {
      expect(encodeKey('a\nb\tc')).toBe('a%0Ab%09c');
    });
  });

  describe('hidden / quirky segments', () => {
    it('rewrites leading dot to %2E', () => {
      expect(encodeKey('.htaccess')).toBe('%2Ehtaccess');
    });

    it('rewrites leading dot in inner segment', () => {
      expect(encodeKey('a/.b/c')).toBe('a/%2Eb/c');
    });

    it('rewrites trailing dot to %2E', () => {
      expect(encodeKey('foo.')).toBe('foo%2E');
    });

    it('rewrites trailing space to %20', () => {
      expect(encodeKey('foo ')).toBe('foo%20');
    });

    it('handles leading-and-trailing-dot segment', () => {
      // leading dot rule fires first; trailing dot rule fires next.
      expect(encodeKey('.hidden.')).toBe('%2Ehidden%2E');
    });
  });

  describe('length cap', () => {
    it('rejects segments whose encoded form exceeds 255 bytes', () => {
      // Each multi-byte UTF-8 char inflates 3x under %XX. 90 emoji = 360 bytes.
      const segment = '\u{1F600}'.repeat(90);
      expect(() => encodeKey(segment)).toThrow(KeyTooLongError);
    });

    it('accepts a 255-byte segment exactly', () => {
      const segment = 'a'.repeat(255);
      expect(encodeKey(segment)).toBe(segment);
    });

    it('rejects a raw segment of 256 bytes at the pre-loop bound (js/loop-bound-injection)', () => {
      // 256 unreserved bytes would encode 1:1 to 256 bytes (> 255). The new
      // pre-loop cap rejects it before the encode loop runs — same accept/reject
      // outcome as the post-encode check it complements.
      expect(() => encodeKey('a'.repeat(256))).toThrow(KeyTooLongError);
    });
  });

  describe('roundtrip', () => {
    it.each([
      'simple.txt',
      'photos/2026/05/20/cat.jpg',
      'my file with spaces.bin',
      'a?b&c=d',
      'cafeé.txt',
      'a\nb',
      '.htaccess',
      'trailing.',
      'trailing ',
      '\u{1F4A9}\u{1F600}.bin',
    ])('roundtrips %j', roundtrip);
  });

  describe('edge cases', () => {
    it('rejects empty key', () => {
      expect(() => encodeKey('')).toThrow(/empty key/);
    });

    it('maps empty segments (//, trailing /) to a safe placeholder that round-trips', () => {
      // An empty segment can't be a real filename ('' → doubled/trailing '/'),
      // so it encodes to the reserved `%2F` placeholder and decodes back to ''.
      expect(encodeKey('a//b')).toBe('a/%2F/b');
      expect(decodeKey('a/%2F/b')).toBe('a//b');
      // Trailing slash = an S3 "folder marker" object (e.g. `photos/`).
      expect(encodeKey('photos/')).toBe('photos/%2F');
      expect(decodeKey('photos/%2F')).toBe('photos/');
    });

    it('decode tolerates malformed % escapes', () => {
      expect(decodeKey('a%ZZ')).toBe('a%ZZ');
      expect(decodeKey('a%')).toBe('a%');
    });
  });
});
