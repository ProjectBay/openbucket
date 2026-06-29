import type { Request } from 'express';

import { InvalidBucketNameError } from '../errors/s3-error';
import { RouteResolver } from './route-resolver';

const ob = (
  fields: Partial<{
    kind: 's3' | 'admin' | 'spa';
    addressingStyle: 'virtual-host' | 'path';
    bucket: string | null;
    keyRaw: string | null;
    key: string | null;
  }>,
): Request =>
  ({
    openbucket: {
      requestId: 'r',
      kind: fields.kind ?? 's3',
      receivedAt: 0,
      addressingStyle: fields.addressingStyle,
      bucket: fields.bucket ?? undefined,
      keyRaw: fields.keyRaw ?? undefined,
      key: fields.key ?? undefined,
    },
  }) as unknown as Request;

describe('RouteResolver (TEST-0101)', () => {
  const r = new RouteResolver();

  it('case 1: kind=admin → InvalidBucketNameError("")', () => {
    expect(() => r.resolve(ob({ kind: 'admin', bucket: 'photos' }))).toThrow(InvalidBucketNameError);
  });

  it('case 2: kind=s3 + bucket=null → InvalidBucketNameError("")', () => {
    try {
      r.resolve(ob({ kind: 's3', bucket: null }));
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidBucketNameError);
      expect((e as InvalidBucketNameError).extra.BucketName).toBe('');
    }
  });

  it('case 3: uppercase + underscore both fail BUCKET_NAME_RE', () => {
    try {
      r.resolve(ob({ bucket: 'Invalid_Bucket' }));
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidBucketNameError);
      expect((e as InvalidBucketNameError).extra.BucketName).toBe('Invalid_Bucket');
    }
  });

  it('case 4: two-char bucket "ab" is too short', () => {
    expect(() => r.resolve(ob({ bucket: 'ab' }))).toThrow(InvalidBucketNameError);
  });

  it('case 5: a 63-char bucket resolves cleanly', () => {
    const long = 'ok' + 'a'.repeat(60) + 'z'; // 63
    expect(long).toHaveLength(63);
    expect(r.resolve(ob({ bucket: long, keyRaw: '' }))).toEqual({ bucket: long, key: '' });
  });

  it('case 6: bucket containing ".." is rejected', () => {
    expect(() => r.resolve(ob({ bucket: 'good..bad' }))).toThrow(InvalidBucketNameError);
  });

  it('case 7: path-style and virtual-host-style produce identical results', () => {
    const path = ob({ addressingStyle: 'path', bucket: 'photos', keyRaw: '2026/sunset.jpg' });
    const vhost = ob({ addressingStyle: 'virtual-host', bucket: 'photos', keyRaw: '2026/sunset.jpg' });
    expect(r.resolve(path)).toEqual(r.resolve(vhost));
    expect(r.resolve(path)).toEqual({ bucket: 'photos', key: '2026/sunset.jpg' });
  });

  it('case 8: bucket=ok + keyRaw=null → key=""', () => {
    expect(r.resolve(ob({ bucket: 'okbucket', keyRaw: null }))).toEqual({ bucket: 'okbucket', key: '' });
  });
});
