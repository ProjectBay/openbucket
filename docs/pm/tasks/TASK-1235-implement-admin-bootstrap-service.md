---
id: TASK-1235
title: Implement AdminBootstrapService.onApplicationBootstrap
story: STORY-0412
status: done
type: implementation
size: M
---

## Description
Implement the first-run admin user seeder with three branches: env-hash provision, generate-temp-and-log, or no-op when admin row exists.

## Files to create / modify
- `apps/backend/src/admin/bootstrap/admin-bootstrap.service.ts` — new

## Implementation notes
- Verbatim from §5.8 (lines 7604–7648):
  ```ts
  @Injectable()
  export class AdminBootstrapService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AdminBootstrapService.name);
    constructor(
      private readonly users: AdminUserRepository,
      private readonly config: ConfigService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
      const envHash = this.config.get<string>('ADMIN_PASSWORD_HASH');
      if (envHash) {
        await this.users.upsert({
          username: 'admin', passwordHash: envHash, mustChangePassword: false,
        });
        this.logger.log('Admin user provisioned from ADMIN_PASSWORD_HASH env.');
        return;
      }
      const existing = await this.users.findByUsername('admin');
      if (existing) return;

      const tempPassword = this.generateTempPassword();
      const hash = await argon2.hash(tempPassword, { type: argon2.argon2id });
      await this.users.insert({
        username: 'admin', passwordHash: hash, mustChangePassword: true,
      });
      this.logger.warn(
        `TEMP-ADMIN-PASSWORD username=admin password=${tempPassword} ` +
        `change-on-first-login=true`,
      );
    }
    private generateTempPassword(): string {
      return randomBytes(18).toString('base64url'); // 24 chars
    }
  }
  ```
- The TEMP-ADMIN-PASSWORD line is intentionally grep-friendly: `docker logs openbucket | grep TEMP-ADMIN-PASSWORD`.
- pino redaction config (EPIC-01) must NOT redact this single field.

## Acceptance criteria
- [ ] `ADMIN_PASSWORD_HASH` env present → upsert with `mustChangePassword: false`.
- [ ] No env, no existing user → insert with random temp password and `mustChangePassword: true`; warn log contains `TEMP-ADMIN-PASSWORD`.
- [ ] No env, existing user → no-op.
- [ ] Temp password is 24 chars (18 bytes base64url).

## Test obligations
- Unit: covered by [TEST-0416]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1201]

## References
- `docs/WHITEPAPER.md` §5.8 (lines 7586–7648)
