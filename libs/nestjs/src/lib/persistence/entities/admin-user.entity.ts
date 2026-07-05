import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

import { AdminUserRepository } from '../repositories/admin-user.repository';
import type { AdminRole } from './types';

// `repository: () => …` is lazy so the entity ↔ repo circular import resolves;
// `MikroOrmModule.forFeature` then auto-provides `AdminUserRepository` at the
// `getRepositoryToken(AdminUser)` token (PersistenceModule aliases the class
// token). The username is the primary key and the JWT `sub`.
@Entity({ tableName: 'admin_users', repository: () => AdminUserRepository })
export class AdminUser {
  @PrimaryKey({ type: 'string', length: 64 })
  username!: string;

  /** argon2id hash. Verified with argon2.verify(). */
  @Property({ type: 'string', length: 256 })
  passwordHash!: string;

  /**
   * Forces a password change on next login (§5.2 / §5.8). Seeded `true` for the
   * first-run admin (STORY-0412) so the bootstrap credential can't be used
   * long-term; surfaced as the `mustChangePassword` access-token claim.
   */
  @Property({ type: 'boolean', default: false })
  mustChangePassword = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  /**
   * Authorization role (EPIC-11, STORY-1002). Defaults to `admin` (a full
   * operator) so the bootstrap seed and every pre-migration row stay full
   * admins — a `readonly` default would silently lock out the only operator.
   * Kept LAST so the column order matches the appended migration column.
   */
  @Property({ type: 'string', length: 16, default: 'admin' })
  role: AdminRole = 'admin';
}
