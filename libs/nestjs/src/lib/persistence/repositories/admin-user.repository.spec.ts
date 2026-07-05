import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';

import { AdminUser } from '../entities/admin-user.entity';
import { AdminUserRepository } from './admin-user.repository';
import { Migration20260520000001_initial } from '../../migrations/Migration20260520000001_initial';
import { Migration20260603000001_admin_must_change_password } from '../../migrations/Migration20260603000001_admin_must_change_password';
import { Migration20260704000001_admin_user_roles } from '../../migrations/Migration20260704000001_admin_user_roles';

const MIGRATIONS = [
  { name: 'Migration20260520000001_initial', class: Migration20260520000001_initial },
  {
    name: 'Migration20260603000001_admin_must_change_password',
    class: Migration20260603000001_admin_must_change_password,
  },
  {
    name: 'Migration20260704000001_admin_user_roles',
    class: Migration20260704000001_admin_user_roles,
  },
];

async function initOrm(): Promise<MikroORM> {
  return MikroORM.init({
    dbName: ':memory:',
    entities: [AdminUser],
    metadataProvider: ReflectMetadataProvider,
    metadataCache: { enabled: false },
    allowGlobalContext: true,
    forceUtcTimezone: true,
    extensions: [Migrator],
    migrations: { migrationsList: MIGRATIONS },
  });
}

/**
 * TASK-3020 / [TEST-1002] cases 1–2 — AdminUserRepository role helpers and the
 * forward-only role backfill migration.
 */
describe('AdminUserRepository (TASK-3020)', () => {
  let orm: MikroORM;

  afterEach(async () => {
    await orm?.close(true);
  });

  const repo = (): AdminUserRepository =>
    orm.em.fork().getRepository(AdminUser) as AdminUserRepository;

  it('backfills a pre-role admin row to role="admin" when the migration runs', async () => {
    orm = await initOrm();
    const migrator = orm.getMigrator();
    // Seed the pre-change schema: everything up to (but not including) the role
    // migration, then insert an admin row while there is no `role` column.
    await migrator.up({ to: 'Migration20260603000001_admin_must_change_password' });
    await orm.em.getConnection().execute(
      `insert into "admin_users" ("username", "password_hash", "must_change_password", "created_at")
       values ('admin', 'hash', 0, '2026-01-01 00:00:00');`,
    );

    // Apply the forward-only role migration.
    await migrator.up();

    const rows = await orm.em
      .getConnection()
      .execute<{ username: string; role: string }[]>(
        `select "username", "role" from "admin_users";`,
      );
    expect(rows).toEqual([{ username: 'admin', role: 'admin' }]);
  });

  it('insert defaults role to admin when omitted, and honours an explicit role', async () => {
    orm = await initOrm();
    await orm.getMigrator().up();

    await repo().insert({ username: 'root', passwordHash: 'h', mustChangePassword: true });
    await repo().insert({
      username: 'viewer',
      passwordHash: 'h',
      mustChangePassword: true,
      role: 'readonly',
    });

    expect((await repo().findByUsername('root'))?.role).toBe('admin');
    expect((await repo().findByUsername('viewer'))?.role).toBe('readonly');
  });

  it('list returns all rows ordered by username', async () => {
    orm = await initOrm();
    await orm.getMigrator().up();
    await repo().insert({ username: 'zed', passwordHash: 'h', mustChangePassword: false });
    await repo().insert({ username: 'amy', passwordHash: 'h', mustChangePassword: false });

    const rows = await repo().list();
    expect(rows.map((r) => r.username)).toEqual(['amy', 'zed']);
  });

  it('countByRole counts only rows carrying the role', async () => {
    orm = await initOrm();
    await orm.getMigrator().up();
    await repo().insert({ username: 'a', passwordHash: 'h', mustChangePassword: false });
    await repo().insert({ username: 'b', passwordHash: 'h', mustChangePassword: false });
    await repo().insert({
      username: 'c',
      passwordHash: 'h',
      mustChangePassword: false,
      role: 'readonly',
    });

    expect(await repo().countByRole('admin')).toBe(2);
    expect(await repo().countByRole('readonly')).toBe(1);
  });

  it('update can reassign a role', async () => {
    orm = await initOrm();
    await orm.getMigrator().up();
    await repo().insert({ username: 'a', passwordHash: 'h', mustChangePassword: false });

    await repo().update('a', { role: 'readonly' });
    expect((await repo().findByUsername('a'))?.role).toBe('readonly');
  });

  it('delete removes the row', async () => {
    orm = await initOrm();
    await orm.getMigrator().up();
    await repo().insert({ username: 'a', passwordHash: 'h', mustChangePassword: false });

    await repo().delete('a');
    expect(await repo().findByUsername('a')).toBeNull();
  });
});
