import { Module } from '@nestjs/common';

import { KeysAdminController } from './keys-admin.controller';
import { KeyService } from '../../domain/keys/key.service';
import { AuditService } from '../audit/audit.service';

/**
 * Admin access-key management endpoints (§5.7). Provides the admin-side
 * KeyService (distinct from the SigV4 KeyService in storage/) and AuditService
 * locally; EntityManager is globally available from MikroOrmModule.
 */
@Module({
  controllers: [KeysAdminController],
  providers: [KeyService, AuditService],
})
export class KeysAdminModule {}
