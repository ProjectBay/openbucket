import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { DomainModule } from '../domain/domain.module';
import { StorageModule } from '../storage/storage.module';
import { KeyService as StorageKeyService } from '../storage/key.service';
import { PolicyAuthorizationGuard } from './authz/policy-authorization.guard';
import { BucketController } from './controllers/bucket.controller';
import { MultipartController } from './controllers/multipart.controller';
import { ObjectController } from './controllers/object.controller';
import { ServiceController } from './controllers/service.controller';
import { CorsController } from './cors/cors.controller';
import { S3ExceptionFilter } from './errors/s3-exception.filter';
import { OperationDispatcherInterceptor } from './routing/operation.decorator';
import { RouteResolver } from './routing/route-resolver';
import { PostObjectInterceptor } from './object/post-object.interceptor';
import { PutObjectInterceptor } from './object/put-object.interceptor';
import { AccessKey, KeyService } from './sigv4/key.service';
import { SigV4Guard } from './sigv4/sigv4.guard';
import { Sigv4Verifier } from './sigv4/sigv4.verifier';
import { ImageTransformService } from './transforms/image-transform.service';
import { XmlInterceptor } from './xml/xml.interceptor';
import { XmlParser } from './xml/xml.parser';
import { XmlSerializer } from './xml/xml.serializer';

/**
 * S3 wire-protocol surface (WHITEPAPER §2). Four controllers — one per
 * resource class (service, bucket, object, multipart) — with a small set of
 * cross-cutting guards/interceptors/filters. Domain services come from
 * `DomainModule` (stubs in STORY-0100; filled in across STORY-0107…0118).
 *
 * Mounted *last* in AppModule's controller-tree imports so the SPA catch-all
 * and admin/health routes (longer, prefixed paths) take priority over the S3
 * controllers' top-level patterns.
 */
@Module({
  imports: [DomainModule, StorageModule],
  // CorsController is declared before ObjectController so the OPTIONS preflight
  // verb is captured here rather than falling through to the object routes (§2.9).
  controllers: [
    ServiceController,
    BucketController,
    CorsController,
    ObjectController,
    MultipartController,
  ],
  providers: [
    RouteResolver,
    SigV4Guard,
    PolicyAuthorizationGuard,
    Sigv4Verifier,
    // Bind the SigV4 abstract KeyService (§2.4.2) onto the concrete
    // persistence-backed KeyService (STORY-0212), mapping its KeyLookupResult
    // (`secret`) onto the AccessKey shape (`secretAccessKey`) the guard expects.
    {
      provide: KeyService,
      inject: [StorageKeyService],
      useFactory: (impl: StorageKeyService): KeyService => ({
        async getSecret(accessKeyId: string): Promise<AccessKey | null> {
          const r = await impl.getSecret(accessKeyId);
          return r
            ? {
                accessKeyId: r.accessKeyId,
                secretAccessKey: r.secret,
                disabled: r.disabled,
                isRoot: r.isRoot,
                scopePolicy: r.scopePolicy ?? null,
              }
            : null;
        },
      }),
    },
    ImageTransformService,
    XmlParser,
    XmlSerializer,
    XmlInterceptor,
    PutObjectInterceptor,
    PostObjectInterceptor,
    S3ExceptionFilter,
    OperationDispatcherInterceptor,
    // Resolve req.openbucket.operation globally — runs before the
    // controller-scoped XmlInterceptor, which gates inbound XML-body parsing
    // on the operation name (§2.3.2 / §2.8).
    { provide: APP_INTERCEPTOR, useExisting: OperationDispatcherInterceptor },
  ],
})
export class S3Module {}
