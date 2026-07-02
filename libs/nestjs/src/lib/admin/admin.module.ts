import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { BucketsAdminModule } from './buckets/buckets-admin.module';
import { ObjectsAdminModule } from './objects/objects-admin.module';
import { KeysAdminModule } from './keys/keys-admin.module';
import { SettingsAdminModule } from './settings/settings-admin.module';
import { BackupModule } from './backup/backup.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AuditService } from './audit/audit.service';
import { AdminBootstrapService } from './bootstrap/admin-bootstrap.service';

/**
 * The admin feature modules that actually declare controllers. Exported as a
 * single source of truth: AdminModule spreads them into its `imports`, and the
 * host-mount RouterModule (open-bucket.module.ts) lists them as routing children.
 * RouterModule only prefixes a listed module's OWN controllers — AdminModule
 * itself has none (it composes these + binds the global guard), so listing
 * AdminModule alone would leave `<mountPath>/api/admin/*` unmounted.
 */
export const ADMIN_CONTROLLER_MODULES = [
  AuthModule,
  BucketsAdminModule,
  ObjectsAdminModule,
  KeysAdminModule,
  SettingsAdminModule,
  BackupModule,
];

/**
 * Root of the `/api/admin/*` controller tree (WHITEPAPER §5.1.1). Imports the
 * five admin feature modules and binds `JwtAuthGuard` globally via `APP_GUARD`
 * so every admin route is authenticated by default; login/refresh opt out with
 * `@Public()`. The throttler default is 100/min per IP (login overrides to
 * 5/min). Controllers are thin adapters over the `domain/*` services.
 */
@Module({
  imports: [
    // Single global throttler config (ThrottlerModule is @Global, so forRoot
    // must be called exactly once app-wide): the 100/min-per-IP default plus
    // the named `login` throttler (5/min) the login endpoint applies. AuthModule
    // (§5.2.1) references the `login` name but must NOT call forRoot again — two
    // @Global forRoots deadlock DI at boot.
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: 100 },
      { ttl: 60_000, limit: 5, name: 'login' },
    ]),
    ...ADMIN_CONTROLLER_MODULES,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    AuditService,
    AdminBootstrapService,
  ],
  exports: [AuditService],
})
export class AdminModule {}
