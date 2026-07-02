import { Logger, Module, Global, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroOrmModule, getRepositoryToken, InjectMikroORM } from '@mikro-orm/nestjs';
import { LibSqlDriver } from '@mikro-orm/libsql';
import { MikroORM, ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Migration20260520000001_initial } from './migrations/Migration20260520000001_initial';
import { Migration20260603000001_admin_must_change_password } from './migrations/Migration20260603000001_admin_must_change_password';
import { Migration20260603000002_refresh_token_redesign } from './migrations/Migration20260603000002_refresh_token_redesign';
import { Migration20260609000001_access_key_admin_fields } from './migrations/Migration20260609000001_access_key_admin_fields';
import { Migration20260625000001_object_encryption } from './migrations/Migration20260625000001_object_encryption';
import { Migration20260701000001_object_content_sha256 } from './migrations/Migration20260701000001_object_content_sha256';
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
  BucketRepository,
  ObjectRepository,
  AdminUserRepository,
  RefreshTokenRepository,
} from './persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from './persistence/orm-context';

const ENTITIES = [
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
];

/**
 * Global persistence wiring. Mirrors `mikro-orm.config.ts` but sources
 * `DATA_DIR` from ConfigService at runtime. See WHITEPAPER §3.1.2.
 *
 * Wired into AppModule as of STORY-0205; the bootstrap runs `getMigrator().up()`
 * before the listener binds (main.ts).
 */
@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      // Named context isolates this ORM from a host that also uses MikroORM.
      contextName: OPEN_BUCKET_ORM_CONTEXT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dataDir = config.getOrThrow<string>('DATA_DIR');
        // libsql (like better-sqlite3) creates the .db file but not its parent
        // directory; ensure DATA_DIR exists (e.g. a freshly-mounted empty volume).
        // Wrap the raw fs error: an unwritable/absent `dataDir` (a common
        // first-run mistake — e.g. the README's `/var/lib/openbucket` on a dev
        // box → EACCES, or a top-level path like `/openbucket` → ENOENT, since
        // `recursive` can't create a directory at the filesystem root) otherwise
        // surfaces as a cryptic mkdir errno with no hint at the cause.
        try {
          mkdirSync(dataDir, { recursive: true });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          throw new Error(
            `OpenBucket: cannot create the data directory "${dataDir}" (${code ?? 'error'}). ` +
              `Set \`dataDir\` (library) / \`DATA_DIR\` (standalone) to a path this ` +
              `process can create and write to — e.g. an absolute path under a ` +
              `writable parent, or a relative path like "./data" in development.`,
            { cause: err },
          );
        }
        return {
        driver: LibSqlDriver,
        // The auto request-context middleware injects the DEFAULT MikroORM
        // token, which a named context does not bind. Disable it; OrmContextMiddleware
        // (wired in OpenBucketCoreModule) creates the per-request context for
        // this named ORM instead. (Read here from MIKRO_ORM_MODULE_OPTIONS.)
        registerRequestContext: false,
        dbName: join(dataDir, 'openbucket.db'),
        entities: ENTITIES,
        // Bundle-safe (see mikro-orm.config.ts).
        metadataProvider: ReflectMetadataProvider,
        // FileCacheAdapter serializes metadata via JSON, which throws on the
        // bigint property defaults (`size: bigint = 0n`). Disable the on-disk
        // cache; TsMorph re-discovers at boot. See mikro-orm.config.ts.
        metadataCache: { enabled: false },
        extensions: [Migrator],
        allowGlobalContext: false,
        forceUtcTimezone: true,
        migrations: {
          // Explicit list, not a filesystem glob: webpack bundles the app into
          // a single main.js, so a `path` glob finds no migration files at
          // runtime. Each new migration is appended here. See STORY-0205.
          migrationsList: [
            { name: 'Migration20260520000001_initial', class: Migration20260520000001_initial },
            {
              name: 'Migration20260603000001_admin_must_change_password',
              class: Migration20260603000001_admin_must_change_password,
            },
            {
              name: 'Migration20260603000002_refresh_token_redesign',
              class: Migration20260603000002_refresh_token_redesign,
            },
            {
              name: 'Migration20260609000001_access_key_admin_fields',
              class: Migration20260609000001_access_key_admin_fields,
            },
            {
              name: 'Migration20260625000001_object_encryption',
              class: Migration20260625000001_object_encryption,
            },
            {
              name: 'Migration20260701000001_object_content_sha256',
              class: Migration20260701000001_object_content_sha256,
            },
          ],
          transactional: true,
          allOrNothing: true,
          snapshot: true,
        },
        pool: {
          afterCreate: (conn: any, done: (err?: Error) => void) => {
            try {
              conn.pragma('journal_mode = WAL');
              // FULL (not NORMAL): fsync the WAL on every commit so a committed
              // object-metadata transaction survives power loss, matching the
              // blob's per-write fsync. NORMAL can silently drop the last
              // commit(s) on power loss — a durability gap vs. the fsync'd blob.
              conn.pragma('synchronous = FULL');
              conn.pragma('foreign_keys = ON');
              conn.pragma('busy_timeout = 5000');
              conn.pragma('temp_store = MEMORY');
              conn.pragma('mmap_size = 268435456');
              conn.pragma('cache_size = -65536');
              done();
            } catch (err) {
              done(err as Error);
            }
          },
        },
        debug: config.get('NODE_ENV') !== 'production',
        };
      },
    }),
    MikroOrmModule.forFeature({ entities: ENTITIES }, OPEN_BUCKET_ORM_CONTEXT),
  ],
  // Re-export the custom repos under their class token so consumers can
  // `@Inject(BucketRepository) repo: BucketRepository` directly. MikroOrmModule
  // already provides them at `getRepositoryToken(X)` because each entity sets
  // `repository: () => XRepo`; this factory just aliases the class token.
  providers: [
    { provide: BucketRepository, inject: [getRepositoryToken(Bucket, OPEN_BUCKET_ORM_CONTEXT)], useFactory: (r: BucketRepository) => r },
    { provide: ObjectRepository, inject: [getRepositoryToken(ObjectEntity, OPEN_BUCKET_ORM_CONTEXT)], useFactory: (r: ObjectRepository) => r },
    { provide: AdminUserRepository, inject: [getRepositoryToken(AdminUser, OPEN_BUCKET_ORM_CONTEXT)], useFactory: (r: AdminUserRepository) => r },
    { provide: RefreshTokenRepository, inject: [getRepositoryToken(RefreshToken, OPEN_BUCKET_ORM_CONTEXT)], useFactory: (r: RefreshTokenRepository) => r },
  ],
  exports: [MikroOrmModule, BucketRepository, ObjectRepository, AdminUserRepository, RefreshTokenRepository],
})
export class PersistenceModule implements OnModuleInit {
  private readonly logger = new Logger(PersistenceModule.name);

  constructor(@InjectMikroORM(OPEN_BUCKET_ORM_CONTEXT) private readonly orm: MikroORM) {}

  /**
   * Run forward-only migrations during module init — BEFORE the DB-querying
   * `OnApplicationBootstrap` services (admin seeding, upload recovery) and the
   * HTTP listener. This makes `OpenBucketModule.forRoot` self-sufficient in a
   * host app (no external `getMigrator().up()` call needed); the standalone app's
   * main.ts call is now idempotent. (Migrations registered explicitly in the
   * forRootAsync config above — webpack bundles main.js so a glob finds nothing.)
   */
  async onModuleInit(): Promise<void> {
    const applied = await this.orm.getMigrator().up();
    if (applied.length > 0) {
      this.logger.log(`Applied ${applied.length} migration(s) on init`);
    }
  }
}
