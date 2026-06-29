import { ReflectMetadataProvider } from '@mikro-orm/core';
import { defineConfig } from '@mikro-orm/better-sqlite';
import { Migrator } from '@mikro-orm/migrations';
import { join } from 'node:path';
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

/**
 * Single source of truth for the MikroORM driver, entity discovery, migration
 * directory, and the WAL-mode PRAGMA hook. Consumed by the `mikro-orm` CLI for
 * migrations; the Nest runtime uses the ConfigService-derived equivalent in
 * `persistence.module.ts`. See WHITEPAPER §3.1.1.
 *
 * The CLI uses the env directly; the Nest runtime passes a ConfigService value.
 */
const DATA_DIR = process.env.DATA_DIR ?? '/data';

export default defineConfig({
  // better-sqlite3 driver — synchronous binding, fastest for embedded use.
  dbName: join(DATA_DIR, 'openbucket.db'),

  // Entities discovered explicitly. No glob scan — startup must be deterministic
  // and we want a compile-time error if an entity is removed.
  entities: [
    Bucket,
    ObjectEntity,
    ObjectVersion,
    MultipartUpload,
    MultipartPart,
    AccessKey,
    AdminUser,
    RefreshToken,
    LifecycleState,
  ],

  // ReflectMetadataProvider (not TsMorph): every entity property declares its
  // MikroORM type explicitly in the decorator, so we don't need ts-morph to
  // read .ts source at runtime. This is bundle-safe (the backend is webpack-
  // bundled into a single main.js; ts-morph cannot find entity source files
  // there) and removes the @mikro-orm/reflection runtime dependency.
  metadataProvider: ReflectMetadataProvider,

  // The on-disk metadata cache (FileCacheAdapter) serializes via JSON, which
  // throws on the bigint property defaults (`size: bigint = 0n`) captured during
  // discovery. Disable it; TsMorph re-discovers at boot (a single-process app
  // boots rarely, so the cost is acceptable).
  metadataCache: { enabled: false },

  // Forward-only migrations.
  extensions: [Migrator],
  migrations: {
    path: join(__dirname, 'migrations'),
    pathTs: join(__dirname, 'migrations'),
    glob: '!(*.d).{js,ts}',
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: true,
  },

  // WAL + tuning PRAGMAs. Runs once per connection. better-sqlite3 opens a
  // single connection per process so this fires exactly once at boot.
  pool: {
    afterCreate: (conn: any, done: (err?: Error) => void) => {
      try {
        // .pragma() is better-sqlite3 native; avoids prepared-statement
        // caching of one-shot PRAGMAs.
        conn.pragma('journal_mode = WAL');
        conn.pragma('synchronous = NORMAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('busy_timeout = 5000');
        conn.pragma('temp_store = MEMORY');
        conn.pragma('mmap_size = 268435456'); // 256 MiB
        conn.pragma('cache_size = -65536'); // 64 MiB page cache
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  },

  // Identity-map per request; one global EM is forked per RequestContext.
  allowGlobalContext: false,

  // Store/read all datetimes as UTC.
  forceUtcTimezone: true,

  // Verbose only in dev. Wired to Pino in production via the module logger.
  debug: process.env.NODE_ENV !== 'production',
});
