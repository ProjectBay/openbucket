import { InvalidArgumentError } from '../errors/s3-error';
import {
  FORMAT_MIME,
  isTransformableContentType,
  isTransformRequest,
  parseTransformParams,
} from './transform-params';

/**
 * TEST-0800 — transform param validation + content-type / request gates. This
 * is the trust boundary, so the tests lean on the bounds: over-cap dimensions,
 * out-of-range quality, non-output formats, and non-numeric values must all be
 * a typed 400 (InvalidArgumentError), never a 500.
 */
describe('transform-params (TASK-2400)', () => {
  const MAX = 4096;

  describe('parseTransformParams', () => {
    it('parses a full valid query', () => {
      expect(parseTransformParams({ w: '200', h: '200', format: 'webp', q: '80' }, MAX)).toEqual({
        width: 200,
        height: 200,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      });
    });

    it('applies fit=cover and q=80 defaults', () => {
      expect(parseTransformParams({ w: '100' }, MAX)).toEqual({
        width: 100,
        height: undefined,
        fit: 'cover',
        format: undefined,
        quality: 80,
      });
    });

    it('accepts height-only, and format-only (re-encode at native size)', () => {
      expect(parseTransformParams({ h: '50' }, MAX).height).toBe(50);
      const fmtOnly = parseTransformParams({ format: 'png' }, MAX);
      expect(fmtOnly.format).toBe('png');
      expect(fmtOnly.width).toBeUndefined();
      expect(fmtOnly.height).toBeUndefined();
    });

    it('honours a non-default fit', () => {
      expect(parseTransformParams({ w: '10', fit: 'inside' }, MAX).fit).toBe('inside');
    });

    it.each([
      ['w over maxDim', { w: '5000' }],
      ['h over maxDim', { h: '99999' }],
      ['w=0', { w: '0' }],
      ['negative w', { w: '-5' }],
      ['non-numeric w', { w: 'abc' }],
      ['q below 1', { w: '10', q: '0' }],
      ['q above 100', { w: '10', q: '101' }],
      ['format=svg', { format: 'svg' }],
      ['format=gif (not an output format)', { format: 'gif' }],
      ['unknown fit', { w: '10', fit: 'squish' }],
    ])('rejects %s with InvalidArgumentError (400, not 500)', (_label, q) => {
      let err: unknown;
      try {
        parseTransformParams(q, MAX);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(InvalidArgumentError);
      expect((err as InvalidArgumentError).httpStatus).toBe(400);
    });
  });

  describe('isTransformableContentType', () => {
    it('allow-lists raster image types', () => {
      for (const ct of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/tiff']) {
        expect(isTransformableContentType(ct)).toBe(true);
      }
      expect(isTransformableContentType('image/JPEG')).toBe(true);
      expect(isTransformableContentType('image/jpeg; charset=binary')).toBe(true);
    });

    it('excludes svg, active content, non-images, and empty', () => {
      expect(isTransformableContentType('image/svg+xml')).toBe(false);
      expect(isTransformableContentType('text/html')).toBe(false);
      expect(isTransformableContentType('application/octet-stream')).toBe(false);
      expect(isTransformableContentType(undefined)).toBe(false);
      expect(isTransformableContentType('')).toBe(false);
    });
  });

  describe('isTransformRequest', () => {
    it('is true when w / h / format is present', () => {
      expect(isTransformRequest({ w: '100' })).toBe(true);
      expect(isTransformRequest({ h: '100' })).toBe(true);
      expect(isTransformRequest({ format: 'webp' })).toBe(true);
    });

    it('is false with no transform params', () => {
      expect(isTransformRequest({})).toBe(false);
      expect(isTransformRequest({ foo: 'bar' })).toBe(false);
      expect(isTransformRequest({ w: '' })).toBe(false);
    });

    it('is false when a sub-resource / version flag is present, even with w=', () => {
      expect(isTransformRequest({ w: '100', tagging: '' })).toBe(false);
      expect(isTransformRequest({ w: '100', versionId: 'v1' })).toBe(false);
      expect(isTransformRequest({ w: '100', acl: '' })).toBe(false);
      expect(isTransformRequest({ w: '100', retention: '' })).toBe(false);
      expect(isTransformRequest({ w: '100', attributes: '' })).toBe(false);
      expect(isTransformRequest({ w: '100', uploadId: 'u1' })).toBe(false);
    });
  });

  it('FORMAT_MIME maps every output format', () => {
    expect(FORMAT_MIME).toEqual({
      webp: 'image/webp',
      jpeg: 'image/jpeg',
      png: 'image/png',
      avif: 'image/avif',
    });
  });
});
