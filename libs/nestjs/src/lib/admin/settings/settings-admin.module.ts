import { Module } from '@nestjs/common';

import { SettingsAdminController } from './settings-admin.controller';
import { AuditService } from '../audit/audit.service';
import { RefreshTokenService } from '../auth/refresh-token.service';

/**
 * Admin settings endpoints (§5.8): the change-password flow. `AdminUserRepository`
 * (PersistenceModule) and `Clock` (ClockModule) are globally provided;
 * `AuditService` and `RefreshTokenService` are provided here (the same
 * stateless-service pattern AuthModule uses) so the controller can record
 * `admin.password.changed` and revoke every outstanding session on rotation
 * (TASK-2101). `RefreshTokenService` depends only on the global
 * `RefreshTokenRepository` + `Clock`, so instantiating a second copy here is safe.
 */
@Module({
  controllers: [SettingsAdminController],
  providers: [AuditService, RefreshTokenService],
})
export class SettingsAdminModule {}
