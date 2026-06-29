import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { MikroORM } from '@mikro-orm/better-sqlite';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
} from './persistence/index';

import { Migration20260520000001_initial } from './migrations/Migration20260520000001_initial';

/**
 * TEST-0205 — the initial migration applies cleanly and matches the entity
 * schema. File-backed (not :memory:) so the WAL companions are produced.
 */
const DATA_DIR = join(process.cwd(), 'tmp', `openbucket-migration-test-${process.pid}`);

describe('initial migration (TEST-0205)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    orm = await MikroORM.init({
      dbName: join(DATA_DIR, 'openbucket.db'),
      entities: [Bucket, ObjectEntity, ObjectVersion, MultipartUpload, MultipartPart, AccessKey, AdminUser, RefreshToken, LifecycleState],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      extensions: [Migrator],
      migrations: {
        migrationsList: [
          { name: 'Migration20260520000001_initial', class: Migration20260520000001_initial },
        ],
      },
      pool: {
        afterCreate: (conn: any, done: (err?: Error) => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.getMigrator().up();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('case 1: up() creates exactly the nine app tables (+ migrations bookkeeping)', async () => {
    // Filter sqlite_*: MikroORM's mikro_orm_migrations PK uses AUTOINCREMENT,
    // which makes SQLite materialize a side-effect `sqlite_sequence` table not
    // part of the application schema. The test plan didn't anticipate it.
    const rows = await orm.em.getConnection().execute<{ name: string }[]>(
      `select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'access_keys',
      'admin_users',
      'buckets',
      'lifecycle_state',
      'mikro_orm_migrations',
      'multipart_parts',
      'multipart_uploads',
      'object_versions',
      'objects',
      'refresh_tokens',
    ]);
  });

  it('case 2: the custom indexes and unique index exist', async () => {
    const rows = await orm.em.getConnection().execute<{ name: string }[]>(
      `select name from sqlite_master where type='index' and name not like 'sqlite_autoindex_%'`,
    );
    const names = rows.map((r) => r.name);
    for (const ix of [
      'uq_objects_bucket_key',
      'ix_objects_bucket_key',
      'ix_objects_bucket_softdeleted',
      'ix_versions_bucket_key_version',
      'ix_versions_bucket_key_created',
      'ix_mpu_bucket_key',
      'ix_mpu_initiated',
      'ix_mpp_upload_part',
      'ix_refresh_subject',
      'ix_refresh_expires',
    ]) {
      expect(names).toContain(ix);
    }
  });

  it('case 3: fk_objects_bucket rejects an object with a non-existent bucket', async () => {
    const conn = orm.em.getConnection();
    // FK enforcement is per-connection and OFF by default in SQLite. The pool
    // `afterCreate` turns it ON, but the migrator's `up()` (with the default
    // `disableForeignKeys: true`) toggles it OFF/ON around the run, and the final
    // state after that toggle varies across better-sqlite3 prebuilds (enforced on
    // some platforms, not others). Assert the constraint deterministically by
    // ensuring enforcement is ON on this connection right before the insert.
    await conn.execute('PRAGMA foreign_keys = ON');
    await expect(
      conn.execute(
        `insert into objects (id, bucket_name, key, etag, created_at, modified_at)
         values ('o1', 'ghost-bucket', 'k', 'e', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
      ),
    ).rejects.toThrow();
  });

  it('case 5: the initial migration is recorded as executed', async () => {
    const executed = await orm.getMigrator().getExecutedMigrations();
    expect(executed.map((m) => m.name)).toContain('Migration20260520000001_initial');
  });

  // Defined last because it mutates the schema for the shared ORM instance.
  it('case 4: down() drops all nine application tables', async () => {
    await orm.getMigrator().down();
    const rows = await orm.em.getConnection().execute<{ name: string }[]>(
      `select name from sqlite_master where type='table'`,
    );
    const names = rows.map((r) => r.name);
    for (const t of [
      'buckets',
      'objects',
      'object_versions',
      'multipart_uploads',
      'multipart_parts',
      'access_keys',
      'admin_users',
      'refresh_tokens',
      'lifecycle_state',
    ]) {
      expect(names).not.toContain(t);
    }
  });
});
