import { Module } from '@nestjs/common';

import { KeysAdminController } from './keys-admin.controller';
import { KeyService } from '../../domain/keys/key.service';
import { AuditService } from '../audit/audit.service';
import { StorageModule } from '../../storage/storage.module';

/**
 * Admin access-key management endpoints (§5.7). Provides the admin-side
 * KeyService (distinct from the SigV4 KeyService in storage/) and AuditService
 * locally; EntityManager is globally available from MikroOrmModule. StorageModule
 * supplies the SigV4 `KeyService` (for cache invalidation on revoke) and the
 * `SecretCipher` the domain service uses to store sub-key secrets (EPIC-11).
 */
@Module({
  imports: [StorageModule],
  controllers: [KeysAdminController],
  providers: [KeyService, AuditService],
})
export class KeysAdminModule {}
