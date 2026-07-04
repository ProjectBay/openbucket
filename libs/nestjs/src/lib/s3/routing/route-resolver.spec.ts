import type { Request } from 'express';

import { InvalidBucketNameError, KeyTooLongError } from '../errors/s3-error';
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

  // TASK-2160 (CWE-770): aggregate 1024-byte key-length cap at the routing seam.
  it('case 9: a key of exactly 1024 bytes is accepted (boundary)', () => {
    const key = 'a'.repeat(1024);
    expect(r.resolve(ob({ bucket: 'okbucket', keyRaw: key }))).toEqual({
      bucket: 'okbucket',
      key,
    });
  });

  it('case 10: a 1025-byte key is rejected with KeyTooLongError', () => {
    const key = 'a'.repeat(1025);
    try {
      r.resolve(ob({ bucket: 'okbucket', keyRaw: key }));
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(KeyTooLongError);
      expect((e as KeyTooLongError).httpStatus).toBe(400);
      expect((e as KeyTooLongError).extra.Size).toBe(1025);
    }
  });

  it('case 11: over-length is measured by UTF-8 byte length, not string length', () => {
    // 600 × "é" = 1200 bytes but 600 code units → must be rejected by byte length.
    const key = 'é'.repeat(600);
    expect(key.length).toBe(600);
    expect(Buffer.byteLength(key, 'utf8')).toBe(1200);
    expect(() => r.resolve(ob({ bucket: 'okbucket', keyRaw: key }))).toThrow(KeyTooLongError);
  });

  it('case 12: a 512-char multi-byte key (1024 bytes) is accepted at the boundary', () => {
    const key = 'é'.repeat(512); // 1024 bytes
    expect(Buffer.byteLength(key, 'utf8')).toBe(1024);
    expect(r.resolve(ob({ bucket: 'okbucket', keyRaw: key }))).toEqual({
      bucket: 'okbucket',
      key,
    });
  });
});
