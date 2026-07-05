import { Module } from '@nestjs/common';

import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from '../../domain/admin-users/admin-users.service';
import { AuditService } from '../audit/audit.service';
import { RefreshTokenService } from '../auth/refresh-token.service';

/**
 * Admin-user management endpoints (EPIC-11, STORY-1002). `AdminUserRepository`
 * (PersistenceModule), `Clock` (ClockModule) and `RefreshTokenRepository` are
 * globally provided, so `AuditService` + `RefreshTokenService` are provided
 * here — the same stateless-service pattern `SettingsAdminModule` uses. Must be
 * listed in `ADMIN_CONTROLLER_MODULES` (admin.module.ts) so it is both imported
 * by AdminModule AND routed as a RouterModule child under a host mount; omitting
 * it would leave `<mountPath>/api/admin/users` unrouted.
 */
@Module({
  controllers: [AdminUsersController],
  providers: [AdminUsersService, AuditService, RefreshTokenService],
})
export class AdminUsersModule {}
