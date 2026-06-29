import { EntityRepository } from '@mikro-orm/better-sqlite';

import { AdminUser } from '../entities/admin-user.entity';

/** Seed payload for the single admin row (§5.8). */
export interface AdminUserSeed {
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
}

/**
 * Repository for the single-tenant admin user table (§5.2). The username is the
 * primary key, so lookups and mutations key on username.
 */
export class AdminUserRepository extends EntityRepository<AdminUser> {
  /** Resolve an admin by username, strict null. Used by AuthService.login. */
  async findByUsername(username: string): Promise<AdminUser | null> {
    return this.findOne({ username });
  }

  /**
   * Insert a fresh admin row (used by first-run bootstrap branch 2). Goes through
   * `em.create` so property initializers (e.g. `createdAt`) are applied — a
   * native insert would skip them. Returns the persisted entity to stay
   * override-compatible with `EntityRepository.insert` (AdminUser has no `id`
   * column, so MikroORM types its primary as the entity itself).
   */
  async insert(data: AdminUserSeed): Promise<AdminUser> {
    const em = this.getEntityManager();
    const row = em.create(AdminUser, { ...data });
    await em.persistAndFlush(row);
    return row;
  }

  /**
   * Insert or update the admin row by username (bootstrap branch 1: provision
   * from `ADMIN_PASSWORD_HASH`). Returns the persisted entity, matching the
   * overridden `EntityRepository.upsert`.
   */
  async upsert(data: AdminUserSeed): Promise<AdminUser> {
    const em = this.getEntityManager();
    let row = await this.findOne({ username: data.username });
    if (row) {
      row.passwordHash = data.passwordHash;
      row.mustChangePassword = data.mustChangePassword;
    } else {
      row = em.create(AdminUser, { ...data });
      em.persist(row);
    }
    await em.flush();
    return row;
  }

  /** Apply field changes to an admin row by username (e.g. password rotation). */
  async update(
    username: string,
    changes: Partial<Pick<AdminUser, 'passwordHash' | 'mustChangePassword'>>,
  ): Promise<void> {
    await this.getEntityManager().nativeUpdate(AdminUser, { username }, changes);
  }
}
