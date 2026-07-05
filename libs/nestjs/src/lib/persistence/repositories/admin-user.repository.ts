import { EntityRepository } from '@mikro-orm/libsql';

import { AdminUser } from '../entities/admin-user.entity';
import type { AdminRole } from '../entities/types';

/**
 * Seed payload for an admin row (§5.8). `role` is optional: when omitted,
 * `em.create` applies the `'admin'` initializer, so `AdminBootstrapService`'s
 * existing `insert`/`upsert` calls keep seeding a full admin unchanged.
 */
export interface AdminUserSeed {
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
  role?: AdminRole;
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

  /**
   * Apply field changes to an admin row by username (e.g. password rotation or a
   * role reassignment). `role` is included so the admin-users CRUD ([TASK-3022])
   * can demote/promote via the same path.
   */
  async update(
    username: string,
    changes: Partial<Pick<AdminUser, 'passwordHash' | 'mustChangePassword' | 'role'>>,
  ): Promise<void> {
    await this.getEntityManager().nativeUpdate(AdminUser, { username }, changes);
  }

  /** All admin rows, ordered by username (used by the admin-users list API). */
  async list(): Promise<AdminUser[]> {
    return this.findAll({ orderBy: { username: 'ASC' } });
  }

  /**
   * Count admin rows carrying `role`. The last-full-admin anti-lockout invariant
   * ([TASK-3022]) is built on `countByRole('admin')`.
   */
  async countByRole(role: AdminRole): Promise<number> {
    return this.count({ role });
  }

  /** Hard-delete an admin row by username (admin-users CRUD delete). */
  async delete(username: string): Promise<void> {
    await this.getEntityManager().nativeDelete(AdminUser, { username });
  }
}
