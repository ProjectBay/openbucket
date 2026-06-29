import type { Request } from 'express';

import type { OpenBucketRequestContext } from './request';

/**
 * TEST-0005 — Express.Request augmentation surfaces typed req.openbucket.
 *
 * The meaningful assertions here are compile-time: this file type-checks
 * under `tsc --noEmit -p tsconfig.spec.json` only if the module
 * augmentation in request.d.ts is in scope without an explicit import of
 * the augmentation file. The runtime expectations below keep Jest happy.
 */
describe('OpenBucketRequestContext augmentation', () => {
  it('case 1: req.openbucket is typed on express Request without importing the .d.ts', () => {
    // A function typed against the stock express Request; the only way
    // `req.openbucket` resolves is via the global module augmentation.
    const readContext = (req: Request): string => req.openbucket.requestId;

    const fake = {
      openbucket: {
        requestId: 'req-1',
        kind: 's3',
        receivedAt: Date.now(),
      } satisfies OpenBucketRequestContext,
    } as unknown as Request;

    expect(readContext(fake)).toBe('req-1');
  });

  it('case 3: exported interface carries the documented fields with correct unions', () => {
    const ctx: OpenBucketRequestContext = {
      requestId: 'req-2',
      kind: 'admin',
      receivedAt: 1,
      bucket: 'b',
      key: 'k',
      addressingStyle: 'path',
      s3Scope: 's3-object',
    };

    expect(ctx.kind).toBe('admin');
    expect(ctx.addressingStyle).toBe('path');
    expect(ctx.s3Scope).toBe('s3-object');
  });

  // case 2 (negative): assigning `req.openbucket.kind = 'banana'` is a
  // compile error. Verified manually with tsc; left as documentation
  // rather than a committed failing line.
});
