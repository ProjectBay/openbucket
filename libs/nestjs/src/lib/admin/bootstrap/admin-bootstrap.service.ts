import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

import { AdminUser, AdminUserRepository } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/**
 * First-run admin seeding (§5.8). Runs in `OnApplicationBootstrap` with three
 * branches:
 *
 *  1. `ADMIN_PASSWORD_HASH` set → upsert the `admin` row with that hash and
 *     `mustChangePassword = false` (ops controls the credential).
 *  2. No env, no existing `admin` row → generate a 24-char temp password,
 *     argon2id-hash it, insert with `mustChangePassword = true`, and log the
 *     plaintext exactly once at `warn` with the grep handle `TEMP-ADMIN-PASSWORD`.
 *  3. Existing `admin` row, no env → no-op.
 *
 * In production the env schema (§1.7) makes `ADMIN_PASSWORD_HASH` required, so
 * branch 1 always wins; branches 2–3 cover dev/test where it is absent.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Bootstrap runs before the listener binds, outside any request context;
    // fork a dedicated EM so the repository doesn't touch the disallowed global
    // context (allowGlobalContext: false). Mirrors RecoveryService (§3.8).
    const users = this.em.fork().getRepository(AdminUser) as AdminUserRepository;
    const envHash = this.config.get<string>('ADMIN_PASSWORD_HASH');

    if (envHash) {
      await users.upsert({
        username: 'admin',
        passwordHash: envHash,
        mustChangePassword: false,
      });
      this.logger.log('Admin user provisioned from ADMIN_PASSWORD_HASH env.');
      return;
    }

    const existing = await users.findByUsername('admin');
    if (existing) return;

    const tempPassword = this.generateTempPassword();
    const hash = await argon2.hash(tempPassword, { type: argon2.argon2id });

    await users.insert({
      username: 'admin',
      passwordHash: hash,
      mustChangePassword: true,
    });

    // Visible in `docker logs openbucket | grep TEMP-ADMIN-PASSWORD`. Logged once,
    // at startup, only when no admin row exists. The pino redact paths target
    // request headers, not log messages, so this single line is not censored.
    this.logger.warn(
      `TEMP-ADMIN-PASSWORD username=admin password=${tempPassword} ` +
        `change-on-first-login=true`,
    );
  }

  private generateTempPassword(): string {
    return randomBytes(18).toString('base64url'); // 18 bytes → 24 base64url chars
  }
}
