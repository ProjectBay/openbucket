import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';

import { AppConfigService } from '../common/config/app-config.service';
import { isLoginRoute, isS3ThrottledRoute } from '../s3/s3-throttle';
import { AuthModule } from './auth/auth.module';
import { BucketsAdminModule } from './buckets/buckets-admin.module';
import { ObjectsAdminModule } from './objects/objects-admin.module';
import { KeysAdminModule } from './keys/keys-admin.module';
import { AdminUsersModule } from './users/admin-users.module';
import { SettingsAdminModule } from './settings/settings-admin.module';
import { BackupModule } from './backup/backup.module';
import { ReplicationAdminModule } from './replication/replication-admin.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
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
  AdminUsersModule,
  SettingsAdminModule,
  BackupModule,
  ReplicationAdminModule,
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
    // must be called exactly once app-wide). Three mutually-exclusive named
    // buckets (TASK-2141): `default` (admin 100/min), `login` (5/min, login route
    // only) and `s3` (a wide, configurable per-IP bucket for the S3 data plane).
    // `ThrottlerGuard` is bound app-wide below; each bucket's `skipIf` keeps it to
    // its own routes so binding it globally doesn't throttle S3 at the admin rate
    // (or admin at the login rate). AuthModule (§5.2.1) references the `login`
    // name but must NOT call forRoot again — two @Global forRoots deadlock DI.
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): ThrottlerModuleOptions => [
        { name: 'default', ttl: 60_000, limit: 100, skipIf: (ctx) => isS3ThrottledRoute(ctx) },
        { name: 'login', ttl: 60_000, limit: 5, skipIf: (ctx) => !isLoginRoute(ctx) },
        {
          name: 's3',
          ttl: config.s3ThrottleTtlMs,
          limit: config.s3ThrottleLimit,
          // Only the S3 controllers, and skipped entirely when disabled (limit 0).
          skipIf: (ctx) => config.s3ThrottleLimit <= 0 || !isS3ThrottledRoute(ctx),
        },
      ],
    }),
    ...ADMIN_CONTROLLER_MODULES,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // RolesGuard (EPIC-11) runs immediately AFTER JwtAuthGuard so `req.user.role`
    // is already the fresh DB value; it default-denies mutating admin routes for
    // read-only principals. Global guards run in registration order.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Bind ThrottlerGuard app-wide (TASK-2141): covers the S3 controllers, not
    // just admin login. Listed after JwtAuthGuard so both APP_GUARDs run.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AuditService,
    AdminBootstrapService,
  ],
  exports: [AuditService],
})
export class AdminModule {}
