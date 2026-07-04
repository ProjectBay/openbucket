import type { ExecutionContext } from '@nestjs/common';

import { BucketController } from './controllers/bucket.controller';
import { MultipartController } from './controllers/multipart.controller';
import { ObjectController } from './controllers/object.controller';
import { ServiceController } from './controllers/service.controller';
import { S3Throttled, isLoginRoute, isS3ThrottledRoute } from './s3-throttle';

/**
 * TEST-0704 — S3 throttle routing (TASK-2141, CWE-770). Verifies the marker +
 * skip predicates that keep the `s3` / `default` / `login` buckets mutually
 * exclusive once ThrottlerGuard is bound app-wide.
 */
const ctxFor = (cls: unknown, req: unknown = {}): ExecutionContext =>
  ({
    getClass: () => cls,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('isS3ThrottledRoute', () => {
  @S3Throttled()
  class Marked {}
  class Unmarked {}

  it('is true for an @S3Throttled class', () => {
    expect(isS3ThrottledRoute(ctxFor(Marked))).toBe(true);
  });

  it('is false for an unmarked class', () => {
    expect(isS3ThrottledRoute(ctxFor(Unmarked))).toBe(false);
  });

  it('tags all four S3 controllers so they use the wide s3 bucket, not admin 100/min', () => {
    for (const c of [ObjectController, BucketController, MultipartController, ServiceController]) {
      expect(isS3ThrottledRoute(ctxFor(c))).toBe(true);
    }
  });
});

describe('isLoginRoute', () => {
  it('is true only for POST <mountPath>/api/admin/auth/login', () => {
    expect(isLoginRoute(ctxFor({}, { method: 'POST', originalUrl: '/storage/api/admin/auth/login' }))).toBe(true);
    expect(isLoginRoute(ctxFor({}, { method: 'POST', originalUrl: '/api/admin/auth/login?x=1' }))).toBe(true);
  });

  it('is false for the wrong verb or a different route', () => {
    expect(isLoginRoute(ctxFor({}, { method: 'GET', originalUrl: '/api/admin/auth/login' }))).toBe(false);
    expect(isLoginRoute(ctxFor({}, { method: 'POST', originalUrl: '/api/admin/auth/refresh' }))).toBe(false);
    expect(isLoginRoute(ctxFor({}, { method: 'PUT', originalUrl: '/mybucket/mykey' }))).toBe(false);
  });
});
