import type { NextFunction, Request, Response } from 'express';

import type { AppConfigService } from '../config/app-config.service';
import {
  RequestClassifierMiddleware,
  decodeKey,
  stripPort,
} from './request-classifier.middleware';

/**
 * TEST-0007 — request classifier decision tree.
 */
function makeConfig(endpoint?: string): AppConfigService {
  return { endpoint } as AppConfigService;
}

function makeReq(path: string, host = ''): Request {
  return {
    path,
    headers: { host },
    openbucket: { requestId: 'r', kind: 's3', receivedAt: 0 },
  } as unknown as Request;
}

function classify(path: string, host: string, endpoint?: string) {
  const mw = new RequestClassifierMiddleware(makeConfig(endpoint));
  const req = makeReq(path, host);
  const next = jest.fn() as unknown as NextFunction;
  mw.use(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req.openbucket;
}

describe('RequestClassifierMiddleware', () => {
  const EP = 's3.example.com';

  it('case 1: /api/admin/health → admin', () => {
    const ctx = classify('/api/admin/health', '');
    expect(ctx.kind).toBe('admin');
    expect(ctx.bucket).toBeUndefined();
  });

  it('case 2: exact /api/admin → admin', () => {
    expect(classify('/api/admin', '').kind).toBe('admin');
  });

  it('case 3: /admin/ → spa', () => {
    expect(classify('/admin/', '').kind).toBe('spa');
  });

  it('case 4: /admin/foo → spa', () => {
    expect(classify('/admin/foo', '').kind).toBe('spa');
  });

  it('case 5: vhost object request', () => {
    const ctx = classify('/key.txt', 'mybucket.s3.example.com', EP);
    expect(ctx.kind).toBe('s3');
    expect(ctx.addressingStyle).toBe('virtual-host');
    expect(ctx.bucket).toBe('mybucket');
    expect(ctx.key).toBe('key.txt');
    expect(ctx.s3Scope).toBe('s3-object');
  });

  it('case 6: vhost bucket-root request', () => {
    const ctx = classify('/', 'mybucket.s3.example.com', EP);
    expect(ctx.bucket).toBe('mybucket');
    expect(ctx.key).toBe('');
    expect(ctx.s3Scope).toBe('s3-bucket');
  });

  it('case 7: uppercase host + port still matches and folds case', () => {
    const ctx = classify('/k', 'MyBucket.S3.EXAMPLE.com:9000', EP);
    expect(ctx.addressingStyle).toBe('virtual-host');
    expect(ctx.bucket).toBe('mybucket');
  });

  it('case 8: malformed vhost label falls through to path style', () => {
    const ctx = classify('/', '_bad_.s3.example.com', EP);
    expect(ctx.addressingStyle).toBe('path');
  });

  it('case 9: path-style nested key', () => {
    const ctx = classify('/bucket/path/to/key', '');
    expect(ctx.addressingStyle).toBe('path');
    expect(ctx.bucket).toBe('bucket');
    expect(ctx.key).toBe('path/to/key');
    expect(ctx.s3Scope).toBe('s3-object');
  });

  it('case 10: path-style root → s3-service', () => {
    const ctx = classify('/', '');
    expect(ctx.s3Scope).toBe('s3-service');
    expect(ctx.bucket).toBeUndefined();
    expect(ctx.key).toBeUndefined();
  });

  it('case 11: percent-decodes the key', () => {
    const ctx = classify('/a%20b/c%2Fd', '');
    // first segment is the bucket; the key is the decoded remainder
    expect(ctx.bucket).toBe('a%20b');
    expect(ctx.key).toBe('c/d');
  });

  it('case 12: malformed percent-encoding falls back to raw (no throw)', () => {
    const ctx = classify('/bucket/bad%2', '');
    expect(ctx.key).toBe('bad%2');
  });

  it('case 13: stripPort handles bracketed IPv6', () => {
    expect(stripPort('[::1]:9000')).toBe('[::1]');
    expect(stripPort('host:9000')).toBe('host');
    expect(stripPort('host')).toBe('host');
  });

  it('case 14: receivedAt is set to ~now', () => {
    const before = Date.now();
    const ctx = classify('/', '');
    expect(ctx.receivedAt).toBeGreaterThanOrEqual(before);
    expect(ctx.receivedAt).toBeLessThanOrEqual(Date.now() + 50);
  });

  it('decodeKey: passthrough and decode', () => {
    expect(decodeKey('plain')).toBe('plain');
    expect(decodeKey('a%20b')).toBe('a b');
    expect(decodeKey('bad%2')).toBe('bad%2');
  });
});
