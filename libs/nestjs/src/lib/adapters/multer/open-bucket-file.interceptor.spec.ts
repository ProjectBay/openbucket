import type { CallHandler, ExecutionContext } from '@nestjs/common';

import type { OpenBucketService } from '../../open-bucket.service';
import { OpenBucketFileInterceptor } from './open-bucket-file.interceptor';

/** A minimal fake service — the interceptor only needs it to build the engine. */
const fakeOb = {
  uploadFrom: jest.fn(),
  deleteObject: jest.fn(),
} as unknown as OpenBucketService;

describe('OpenBucketFileInterceptor', () => {
  it('returns an injectable interceptor mixin (a class)', () => {
    const Interceptor = OpenBucketFileInterceptor('file', { bucket: 'uploads' });
    expect(typeof Interceptor).toBe('function');
  });

  it('constructs with the injected OpenBucketService and exposes intercept()', () => {
    const Interceptor = OpenBucketFileInterceptor('file', {
      bucket: 'uploads',
      key: 'uuid',
    });
    const instance = new Interceptor(fakeOb);
    expect(typeof instance.intercept).toBe('function');
  });

  it('delegates intercept() to the underlying FileInterceptor', () => {
    const Interceptor = OpenBucketFileInterceptor('file', { bucket: 'uploads' });
    const instance = new Interceptor(fakeOb) as InstanceType<typeof Interceptor> & {
      delegate: { intercept: jest.Mock };
    };
    const spy = jest
      .spyOn(instance.delegate, 'intercept')
      .mockReturnValue('DELEGATED' as never);
    const ctx = {} as ExecutionContext;
    const next = { handle: jest.fn() } as unknown as CallHandler;

    const result = instance.intercept(ctx, next);

    expect(spy).toHaveBeenCalledWith(ctx, next);
    expect(result).toBe('DELEGATED');
  });
});
