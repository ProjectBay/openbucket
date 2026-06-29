import { Module } from '@nestjs/common';

import { SettingsAdminController } from './settings-admin.controller';
import { AuditService } from '../audit/audit.service';

/**
 * Admin settings endpoints (§5.8): the change-password flow. `AdminUserRepository`
 * is globally provided by PersistenceModule; `AuditService` is provided here
 * (the same stateless-emitter pattern AuthModule uses) so the controller can
 * record `admin.password.changed`.
 */
@Module({
  controllers: [SettingsAdminController],
  providers: [AuditService],
})
export class SettingsAdminModule {}
