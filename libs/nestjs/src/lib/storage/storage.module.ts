import { Module } from '@nestjs/common';

import { BlobStore } from './blob-store';
import { DerivativeCacheService } from './derivative-cache.service';
import { FreeSpaceService } from './free-space.service';
import { IntegrityRepairService } from './integrity-repair.service';
import { IntegrityVerifier } from './integrity-verifier.service';
import { KeyService } from './key.service';
import { ObjectWriterService } from './object-writer.service';
import { RecoveryService } from './recovery.service';
import { SseKeyService } from './sse-key.service';
import { VersionStoreService } from './version-store.service';
import { SecretCipher } from '../domain/keys/secret-cipher';

/**
 * Filesystem storage layer. BlobStore (§3.6, STORY-0208), two-phase
 * ObjectWriterService with demote-on-write (§3.7 + §3.11.3, STORY-0209/0213),
 * startup RecoveryService (§3.8, STORY-0210), KeyService (§3.10, STORY-0212),
 * and VersionStoreService (§3.11, STORY-0213).
 */
@Module({
  providers: [BlobStore, DerivativeCacheService, FreeSpaceService, IntegrityVerifier, IntegrityRepairService, ObjectWriterService, RecoveryService, KeyService, SseKeyService, VersionStoreService, SecretCipher],
  exports: [BlobStore, DerivativeCacheService, FreeSpaceService, IntegrityVerifier, IntegrityRepairService, ObjectWriterService, RecoveryService, KeyService, SseKeyService, VersionStoreService, SecretCipher],
})
export class StorageModule {}
