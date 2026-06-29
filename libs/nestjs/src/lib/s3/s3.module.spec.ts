import { Global, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { AppConfigService } from '../common/config/app-config.service';
import { BucketService } from '../domain/buckets/bucket.service';
import { LifecycleService } from '../domain/lifecycle/lifecycle.service';
import { MultipartService } from '../domain/multipart/multipart.service';
import { ObjectService } from '../domain/objects/object.service';
import { BlobStore } from '../storage/blob-store';
import { KeyService as StorageKeyService } from '../storage/key.service';
import { ObjectWriterService } from '../storage/object-writer.service';
import { RecoveryService } from '../storage/recovery.service';
import { VersionStoreService } from '../storage/version-store.service';
import { ObjectController } from './controllers/object.controller';
import { NotImplementedError } from './errors/s3-error';
import {
  OperationDispatcherInterceptor,
  S3_OPERATION_KEY,
  S3Operation,
} from './routing/operation.decorator';
import { RouteResolver } from './routing/route-resolver';
import { S3Module } from './s3.module';

/**
 * Global stub for AppConfigService so the PutObjectInterceptor (bound on
 * ObjectController.put via @UseInterceptors) can be constructed without the
 * real global ConfigModule.
 */
@Global()
@Module({
  providers: [{ provide: AppConfigService, useValue: { maxObjectSizeMb: 5_120_000 } }],
  exports: [AppConfigService],
})
class FakeConfigModule {}

/**
 * TEST-0100 — S3 controller topology + dispatcher pattern.
 */
describe('S3 controller topology (TEST-0100)', () => {
  // ---------- case 1: module compiles ------------------------------------

  it('case 1: S3Module compiles with mocked services + all four controllers register', async () => {
    // S3Module imports StorageModule (for the SigV4 KeyService binding, §2.4.2);
    // its persistence-backed providers need the global EntityManager, which the
    // unit container has no MikroORM for. Override them with light stubs so the
    // topology compiles without booting SQLite.
    const moduleRef = await Test.createTestingModule({
      imports: [FakeConfigModule, S3Module],
    })
      .overrideProvider(BucketService)
      .useValue({})
      .overrideProvider(ObjectService)
      .useValue({})
      .overrideProvider(MultipartService)
      .useValue({})
      .overrideProvider(LifecycleService)
      .useValue({})
      .overrideProvider(BlobStore)
      .useValue({})
      .overrideProvider(ObjectWriterService)
      .useValue({})
      .overrideProvider(RecoveryService)
      .useValue({})
      .overrideProvider(VersionStoreService)
      .useValue({})
      .overrideProvider(StorageKeyService)
      .useValue({ getSecret: async () => null })
      .compile();

    // All four controllers resolve from the container.
    for (const Ctor of [
      (await import('./controllers/service.controller')).ServiceController,
      (await import('./controllers/bucket.controller')).BucketController,
      (await import('./controllers/object.controller')).ObjectController,
      (await import('./controllers/multipart.controller')).MultipartController,
    ]) {
      expect(moduleRef.get(Ctor, { strict: false })).toBeDefined();
    }
    await moduleRef.close();
  }, 30_000);

  // ---------- case 2: @S3Operation → req.openbucket.operation ------------

  it('case 2: @S3Operation propagates the operation name via the interceptor', async () => {
    // Decorate a sample handler method with @S3Operation(...) so we can read
    // the metadata via the same Reflector path the production interceptor uses.
    class SampleController {
      @S3Operation('PutObject')
      handler(): string {
        return 'ok';
      }
    }
    const sample = new SampleController();

    const reflector = new Reflector();
    // Sanity: the metadata is on the handler.
    expect(reflector.get<string>(S3_OPERATION_KEY, sample.handler)).toBe('PutObject');

    const interceptor = new OperationDispatcherInterceptor(reflector);
    const req = { openbucket: { requestId: 'r', kind: 's3', receivedAt: 0 } as Record<string, unknown> };
    const ctx = {
      getHandler: () => sample.handler,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('ok') };

    await firstValueFrom(interceptor.intercept(ctx, next));
    expect(req.openbucket.operation).toBe('PutObject');
  });

  // ---------- cases 3-6: ObjectController dispatcher ---------------------

  const fakeReq = (
    query: Record<string, string | undefined>,
    headers: Record<string, string> = {},
  ) =>
    ({
      query,
      headers,
      openbucket: {
        requestId: 'rid',
        kind: 's3',
        receivedAt: 0,
        // 3-char minimum per BUCKET_NAME_RE (RouteResolver, STORY-0101).
        bucket: 'bkt',
        key: 'k',
      },
    }) as unknown as import('express').Request;
  const fakeRes = () => ({}) as unknown as import('express').Response;
  const routes = new RouteResolver();

  it('case 3: PUT /b/k?uploadId=u&partNumber=1 → MultipartService.uploadPart', () => {
    const objects = {} as ObjectService;
    const multipart = {
      uploadPart: jest.fn().mockReturnValue('mp-uploadPart'),
      uploadPartCopy: jest.fn(),
    } as unknown as MultipartService;
    const ctrl = new ObjectController(objects, multipart, routes);
    const result = ctrl.put(fakeReq({ uploadId: 'u', partNumber: '1' }), fakeRes());
    expect(result).toBe('mp-uploadPart');
    expect((multipart as unknown as { uploadPartCopy: jest.Mock }).uploadPartCopy).not.toHaveBeenCalled();
  });

  it('case 4: PUT /b/k?uploadId=u&partNumber=1 + x-amz-copy-source → MultipartService.uploadPartCopy', () => {
    const objects = {} as ObjectService;
    const multipart = {
      uploadPart: jest.fn(),
      uploadPartCopy: jest.fn().mockReturnValue('mp-uploadPartCopy'),
    } as unknown as MultipartService;
    const ctrl = new ObjectController(objects, multipart, routes);
    const result = ctrl.put(
      fakeReq({ uploadId: 'u', partNumber: '1' }, { 'x-amz-copy-source': 'src/key' }),
      fakeRes(),
    );
    expect(result).toBe('mp-uploadPartCopy');
    expect((multipart as unknown as { uploadPart: jest.Mock }).uploadPart).not.toHaveBeenCalled();
  });

  it('case 5: POST /b/k?uploads → MultipartService.createUpload', async () => {
    const objects = {} as ObjectService;
    const multipart = {
      createUpload: jest.fn().mockReturnValue('mp-createUpload'),
    } as unknown as MultipartService;
    const ctrl = new ObjectController(objects, multipart, routes);
    const result = await ctrl.post(fakeReq({ uploads: '' }), fakeRes());
    expect(result).toBe('mp-createUpload');
  });

  it('case 6: POST /b/k?select → throws NotImplementedError("SelectObjectContent")', async () => {
    const ctrl = new ObjectController({} as ObjectService, {} as MultipartService, routes);
    await expect(ctrl.post(fakeReq({ select: '' }), fakeRes())).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(ctrl.post(fakeReq({ select: '' }), fakeRes())).rejects.toThrow(
      /SelectObjectContent/,
    );
  });
});
