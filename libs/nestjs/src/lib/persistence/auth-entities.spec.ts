import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { AccessKey } from './entities/access-key.entity';
import { AdminUser } from './entities/admin-user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

/**
 * TEST-0203 — auth entity persistence round-trip against real :memory: SQLite.
 * Schema built via the SchemaGenerator (initial migration is STORY-0205).
 */
describe('auth entities (TEST-0203)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [AccessKey, AdminUser, RefreshToken],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  it('case 1: AccessKey defaults (label empty, not disabled, createdAt set)', async () => {
    const em = orm.em.fork();
    em.create(AccessKey, { accessKeyId: 'AKIA', id: 'ak-0001', secretHash: 'argon2id$hash' });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(AccessKey, { accessKeyId: 'AKIA' });
    expect(read.label).toBe('');
    expect(read.disabled).toBe(false);
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it('case 2: AdminUser PK is username and rejects a duplicate', async () => {
    const em1 = orm.em.fork();
    em1.create(AdminUser, { username: 'root', passwordHash: 'argon2id$pw' });
    await em1.flush();

    const em2 = orm.em.fork();
    em2.create(AdminUser, { username: 'root', passwordHash: 'argon2id$pw2' });
    await expect(em2.flush()).rejects.toThrow();
  });

  it('case 3: RefreshToken persists and reads back', async () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date(issuedAt.getTime() + 7 * 24 * 3600 * 1000);
    const em = orm.em.fork();
    em.create(RefreshToken, {
      id: 'r1',
      lookup: 'sha256hex',
      hash: 'argon2id$gate',
      subjectId: 'admin',
      username: 'admin',
      issuedAt,
      expiresAt,
    });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(RefreshToken, { id: 'r1' });
    expect(read.subjectId).toBe('admin');
    expect(read.lookup).toBe('sha256hex');
    expect(read.hash).toBe('argon2id$gate');
    expect(read.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('case 4: rotatedFromId chain pointer is preserved', async () => {
    const em = orm.em.fork();
    em.create(RefreshToken, {
      id: 'r2',
      lookup: 'sha2',
      hash: 'argon2id$gate2',
      subjectId: 'admin',
      username: 'admin',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      rotatedFromId: 'r1',
    });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(RefreshToken, { id: 'r2' });
    expect(read.rotatedFromId).toBe('r1');
  });

  it('case 5: refresh-token indexes exist', async () => {
    const rows = await orm.em.getConnection().execute<{ name: string }[]>(
      `select name from sqlite_master where type='index' and name like 'ix_refresh_%'`,
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('ix_refresh_subject');
    expect(names).toContain('ix_refresh_expires');
  });

  it('pass criterion: credentials are stored hashed, no plaintext columns', async () => {
    const conn = orm.em.getConnection();
    const akCols = (await conn.execute<{ name: string }[]>(`PRAGMA table_info(access_keys)`)).map((c) => c.name);
    const auCols = (await conn.execute<{ name: string }[]>(`PRAGMA table_info(admin_users)`)).map((c) => c.name);
    expect(akCols).toContain('secret_hash');
    expect(akCols).not.toContain('secret');
    expect(auCols).toContain('password_hash');
    expect(auCols).not.toContain('password');
  });
});
