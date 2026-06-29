import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigModule } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import { Test, TestingModule } from '@nestjs/testing';

import { PersistenceModule } from './persistence.module';
import { OPEN_BUCKET_ORM_CONTEXT } from './persistence/orm-context';

/**
 * TEST-0200 — PRAGMA hook and config wiring.
 *
 * Uses a real file-backed better-sqlite3 DB (not :memory:) since WAL mode is
 * only meaningful on a file. Boots a minimal Nest module importing
 * PersistenceModule with DATA_DIR pointing at a temp dir.
 */
const DATA_DIR = join(process.cwd(), 'tmp', `openbucket-pragma-test-${process.pid}`);
const DB_PATH = join(DATA_DIR, 'openbucket.db');

describe('PersistenceModule (TEST-0200)', () => {
  let moduleRef: TestingModule;
  let orm: MikroORM;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ DATA_DIR, NODE_ENV: 'test' })],
        }),
        PersistenceModule,
      ],
    }).compile();

    // PersistenceModule registers its ORM under a named context (host-isolation,
    // phase 5), so the default MikroORM token is not bound — resolve by name.
    orm = moduleRef.get<MikroORM>(getMikroORMToken(OPEN_BUCKET_ORM_CONTEXT));
    // Touch the connection so WAL companion files materialize.
    await orm.em.getConnection().execute('select 1');
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
    await moduleRef?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  // PRAGMA result column names are not always the pragma name (e.g.
  // `PRAGMA busy_timeout` returns a column called `timeout`), so read the
  // first column of the first row regardless of its key.
  const pragma = async (name: string): Promise<unknown> => {
    const rows = await orm.em.getConnection().execute<Record<string, unknown>[]>(`PRAGMA ${name}`);
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  };

  it('case 1: journal_mode is WAL on a file-backed DB', async () => {
    expect(String(await pragma('journal_mode')).toLowerCase()).toBe('wal');
  });

  it('case 2: all tuning PRAGMAs are applied', async () => {
    expect(Number(await pragma('foreign_keys'))).toBe(1);
    expect(Number(await pragma('busy_timeout'))).toBe(5000);
    expect(Number(await pragma('temp_store'))).toBe(2); // MEMORY
    expect(Number(await pragma('mmap_size'))).toBeGreaterThanOrEqual(268_435_456);
    expect(Number(await pragma('cache_size'))).toBe(-65_536);
    expect(Number(await pragma('synchronous'))).toBe(1); // NORMAL
  });

  it('case 3: a forked EM connection executes a trivial query', async () => {
    const rows = await orm.em.fork().getConnection().execute('select 1 as x');
    expect(rows).toEqual([{ x: 1 }]);
  });

  it('case 4: the orm CLI script resolves and prints help', () => {
    const out = execSync('npm run -w apps/openbucket-backend orm -- --help', {
      // repo root: libs/nestjs/src/lib → ../../../..
      cwd: join(__dirname, '..', '..', '..', '..'),
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(out).toMatch(/mikro-orm|Usage|migration/i);
  }, 60_000);

  it('pass criterion: WAL companion files exist next to the db', () => {
    expect(existsSync(DB_PATH)).toBe(true);
    expect(existsSync(`${DB_PATH}-wal`)).toBe(true);
    expect(existsSync(`${DB_PATH}-shm`)).toBe(true);
  });
});
