import { Module } from '@nestjs/common';

import { BlobStore } from './blob-store';
import { KeyService } from './key.service';
import { ObjectWriterService } from './object-writer.service';
import { RecoveryService } from './recovery.service';
import { SseKeyService } from './sse-key.service';
import { VersionStoreService } from './version-store.service';

/**
 * Filesystem storage layer. BlobStore (§3.6, STORY-0208), two-phase
 * ObjectWriterService with demote-on-write (§3.7 + §3.11.3, STORY-0209/0213),
 * startup RecoveryService (§3.8, STORY-0210), KeyService (§3.10, STORY-0212),
 * and VersionStoreService (§3.11, STORY-0213).
 */
@Module({
  providers: [BlobStore, ObjectWriterService, RecoveryService, KeyService, SseKeyService, VersionStoreService],
  exports: [BlobStore, ObjectWriterService, RecoveryService, KeyService, SseKeyService, VersionStoreService],
})
export class StorageModule {}
