import { resolve, sep } from 'node:path';

import { PathEscapeError, PathResolver } from './paths';

/**
 * Containment-barrier coverage for the CWE-22 defense-in-depth guard added to
 * PathResolver. Two properties:
 *   1. Every real (codec-encoded or well-formed) input resolves to a path
 *      contained within DATA_DIR — the barrier is a no-op that never changes
 *      the layout.
 *   2. A crafted traversal segment that reaches a resolver un-encoded (bucket
 *      name, uploadId) is rejected with PathEscapeError instead of escaping.
 */
describe('PathResolver containment barrier', () => {
  const DATA = '/data';
  const paths = new PathResolver(DATA);
  const blobs = resolve(DATA, 'blobs');
  const multipart = resolve(DATA, 'multipart');

  const within = (p: string, base: string) => p === base || p.startsWith(base + sep);

  describe('contained for well-formed input', () => {
    it('blobPath stays under blobs/', () => {
      const p = paths.blobPath('mybucket', 'a/b/c.txt');
      expect(within(p, blobs)).toBe(true);
    });

    it('a key full of ".." is codec-encoded, so it stays contained (no throw)', () => {
      const p = paths.blobPath('mybucket', '../../../etc/passwd');
      expect(within(p, blobs)).toBe(true);
      // ".." never survives as a literal traversal segment.
      expect(p).not.toContain(`${sep}..${sep}`);
    });

    it('versionPath / multipartPartPath stay under their bases', () => {
      expect(within(paths.versionPath('b', 'k', 'v1'), blobs)).toBe(true);
      expect(within(paths.multipartPartPath('upload-1', 3), multipart)).toBe(true);
    });
  });

  describe('rejects un-encoded traversal at the barrier', () => {
    it('a traversal bucket name throws PathEscapeError', () => {
      expect(() => paths.bucketDir('../../etc')).toThrow(PathEscapeError);
      expect(() => paths.blobPath('../../etc', 'k')).toThrow(PathEscapeError);
    });

    it('a traversal uploadId throws PathEscapeError', () => {
      expect(() => paths.multipartDir('../../../etc')).toThrow(PathEscapeError);
      expect(() => paths.multipartPartPath('../../../etc', 1)).toThrow(PathEscapeError);
    });

    it('an absolute-escape bucket throws PathEscapeError', () => {
      // join() would let a leading-slash-heavy name resolve elsewhere; the
      // barrier catches anything that lands outside blobs/.
      expect(() => paths.bucketDir('../../../../../../tmp')).toThrow(PathEscapeError);
    });
  });
});
