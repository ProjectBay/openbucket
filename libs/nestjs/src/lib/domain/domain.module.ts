import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module';
import { ContinuationToken } from '../s3/pagination/continuation-token';
import { XmlSerializer } from '../s3/xml/xml.serializer';
import { BucketService } from './buckets/bucket.service';
import { LifecycleService } from './lifecycle/lifecycle.service';
import { MultipartService } from './multipart/multipart.service';
import { ObjectService } from './objects/object.service';
import { TieringService } from './tiering/tiering.service';
import { ReconcileService } from './replication/reconcile.service';
import { ReplicationStatusService } from './replication/replication-status.service';
import { IntegrityStatusService } from './integrity/integrity-status.service';

/**
 * Hosts the S3 domain services consumed by both the S3 controller tree
 * (EPIC-02) and the admin API (EPIC-05).
 *
 * `XmlSerializer` is a stateless, dependency-free utility; it's provided here
 * (a separate instance from S3Module's) so ObjectService can serialize the
 * GetObjectAttributes response itself — the object GET dispatch runs in
 * library-specific mode, where the XmlInterceptor can't finalize the body.
 */
@Module({
  imports: [StorageModule],
  // ContinuationToken holds a per-process HMAC secret — a single instance lives
  // here (the bucket listing is its only consumer), not duplicated in S3Module.
  providers: [
    BucketService,
    ObjectService,
    MultipartService,
    LifecycleService,
    TieringService,
    ReconcileService,
    ReplicationStatusService,
    IntegrityStatusService,
    XmlSerializer,
    ContinuationToken,
  ],
  exports: [
    BucketService,
    ObjectService,
    MultipartService,
    LifecycleService,
    TieringService,
    ReconcileService,
    ReplicationStatusService,
    IntegrityStatusService,
  ],
})
export class DomainModule {}
