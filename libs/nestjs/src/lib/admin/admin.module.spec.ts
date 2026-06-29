import { APP_GUARD } from '@nestjs/core';

import { AdminModule } from './admin.module';
import { AuditService } from './audit/audit.service';
import { AdminBootstrapService } from './bootstrap/admin-bootstrap.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { BucketsAdminModule } from './buckets/buckets-admin.module';
import { ObjectsAdminModule } from './objects/objects-admin.module';
import { KeysAdminModule } from './keys/keys-admin.module';
import { SettingsAdminModule } from './settings/settings-admin.module';

/**
 * TEST-0400 — AdminModule wiring (§5.1.1). Asserted via module metadata rather
 * than by compiling: AdminModule now transitively imports PersistenceModule +
 * JwtModule (through the real AuthModule), so a full compile needs the DB/config
 * env — that whole-graph boot is already covered by app.module.spec. Here we
 * check the §5.1.1 shape. The guard's behaviour is covered by TEST-0408.
 */
describe('AdminModule (TEST-0400)', () => {
  const imports = Reflect.getMetadata('imports', AdminModule) as unknown[];
  const providers = Reflect.getMetadata('providers', AdminModule) as Array<{
    provide?: unknown;
    useClass?: unknown;
  }>;
  const exports = Reflect.getMetadata('exports', AdminModule) as unknown[];

  it('imports the five admin feature modules and a throttler', () => {
    for (const mod of [
      AuthModule,
      BucketsAdminModule,
      ObjectsAdminModule,
      KeysAdminModule,
      SettingsAdminModule,
    ]) {
      expect(imports).toContain(mod);
    }
    // ThrottlerModule.forRoot(...) contributes a dynamic module (an object with
    // a `module` property), not a class.
    const hasThrottler = imports.some(
      (i) => typeof i === 'object' && i !== null && 'module' in (i as object),
    );
    expect(hasThrottler).toBe(true);
  });

  it('binds JwtAuthGuard globally via APP_GUARD and provides/exports the audit + bootstrap services', () => {
    const guardBinding = providers.find((p) => p && p.provide === APP_GUARD);
    expect(guardBinding?.useClass).toBe(JwtAuthGuard);
    expect(providers).toContain(AuditService);
    expect(providers).toContain(AdminBootstrapService);
    expect(exports).toContain(AuditService);
  });
});
