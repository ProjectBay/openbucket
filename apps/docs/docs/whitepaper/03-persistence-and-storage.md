# 3. Persistence & Storage Layer

This section specifies the durable substrate beneath OpenBucket: the SQLite-backed metadata store, the path-mirrored blob store, and the discipline that keeps the two consistent across crashes. Everything here is single-process, single-host, single-volume. There is no distributed locking, no replication, no quorum — just one Node process, one event loop, one filesystem, one SQLite file, and a small set of rules that make atomic writes possible.

The layer is split across two locations in the Nx workspace:

- `libs/persistence/` — pure metadata: MikroORM entities, repositories, the `mikro-orm.config.ts`, and migrations. Importable by any service.
- `apps/openbucket-backend/src/storage/` — runtime filesystem code: `BlobStore`, key encoder, orphan scanner, trash manager. Lives with the app because it depends on `ConfigService` for `DATA_DIR`.

Migrations live under `apps/openbucket-backend/src/migrations/` because they are produced and applied at runtime against the configured `DATA_DIR`, not packaged with the library.

---

## 3.1 MikroORM bootstrap

### 3.1.1 `mikro-orm.config.ts`

The config is the single source of truth for the driver, entity discovery, migration directory, and the WAL-mode PRAGMA hook. It is consumed by both the runtime `MikroOrmModule.forRoot(...)` and the `mikro-orm` CLI for migrations.

`apps/openbucket-backend/src/mikro-orm.config.ts`

```ts
import { defineConfig } from '@mikro-orm/better-sqlite';
import { Migrator } from '@mikro-orm/migrations';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
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
} from '@openbucket/persistence';

/**
 * Resolved once at module load. The CLI uses the env directly; the Nest runtime
 * passes a ConfigService-derived value into MikroOrmModule.forRootAsync below.
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

  // Reflection-free metadata provider; ts-morph reads decorators from the .ts
  // sources at build time, producing a metadata cache. Required when entities
  // ship in a separate lib (no decorators-in-runtime issue).
  metadataProvider: TsMorphMetadataProvider,

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
        // The .pragma() form is better-sqlite3 native; .prepare()/.run() also
        // works but pragma() avoids prepared-statement caching of one-shots.
        conn.pragma('journal_mode = WAL');
        conn.pragma('synchronous = NORMAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('busy_timeout = 5000');
        conn.pragma('temp_store = MEMORY');
        conn.pragma('mmap_size = 268435456'); // 256 MiB
        conn.pragma('cache_size = -65536');   // 64 MiB page cache
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  },

  // Identity-map per request; one global EM is forked per RequestContext.
  allowGlobalContext: false,

  // Discriminate scalar JSON columns from real relations.
  forceUtcTimezone: true,

  // Verbose only in dev. Wire to Pino in production via MikroOrmModule logger.
  debug: process.env.NODE_ENV !== 'production',
});
```

### 3.1.2 NestJS integration

`apps/openbucket-backend/src/persistence.module.ts`

```ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
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
  BucketRepository,
  ObjectRepository,
} from '@openbucket/persistence';

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

@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        driver: BetterSqliteDriver,
        dbName: join(config.getOrThrow<string>('DATA_DIR'), 'openbucket.db'),
        entities: ENTITIES,
        metadataProvider: TsMorphMetadataProvider,
        extensions: [Migrator],
        allowGlobalContext: false,
        forceUtcTimezone: true,
        migrations: {
          path: join(__dirname, 'migrations'),
          glob: '!(*.d).{js,ts}',
          transactional: true,
          allOrNothing: true,
          snapshot: true,
        },
        pool: {
          afterCreate: (conn: any, done: (err?: Error) => void) => {
            try {
              conn.pragma('journal_mode = WAL');
              conn.pragma('synchronous = NORMAL');
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
      }),
    }),
    MikroOrmModule.forFeature({ entities: ENTITIES }),
  ],
  providers: [BucketRepository, ObjectRepository],
  exports: [MikroOrmModule, BucketRepository, ObjectRepository],
})
export class PersistenceModule {}
```

The `MikroOrmMiddleware` shipped with `@mikro-orm/nestjs` wraps every request in a `RequestContext`. It is applied globally — wired up in the backend's `main.ts` (out of scope for this section; the backend-architect agent owns app bootstrap):

```ts
// reference only — see §1 of the backend-architect deliverable
app.use(MikroOrmMiddleware);
```

With that middleware in place, any service that injects `EntityManager` gets a forked, request-scoped manager with an isolated identity map. No global EM. No leaks across requests.

### 3.1.3 Migration CLI workflow

`apps/openbucket-backend/package.json` (excerpt):

```json
{
  "scripts": {
    "orm": "mikro-orm --config=src/mikro-orm.config.ts",
    "orm:migration:create": "npm run orm -- migration:create",
    "orm:migration:up": "npm run orm -- migration:up",
    "orm:migration:list": "npm run orm -- migration:list",
    "orm:schema:fresh": "npm run orm -- schema:fresh"
  }
}
```

Migrations are **forward-only**. There is no `migration:down` workflow in production — the only supported recovery is "restore the volume". This matches the constraint that SQLite cannot be schema-rolled-back cheaply on a live data set, and it sidesteps the need for paired up/down maintenance on every change. The `mikro-orm.config.ts` deliberately omits no special flags for down-migrations; the generator still emits them, but operationally they are dead code.

The initial migration is created with:

```
npm run orm:migration:create -- --initial
```

It is committed to the repo. On container boot, the backend runs `orm:migration:up` before binding the HTTP listener — described in §3.3.

---

## 3.2 Entity definitions

All entities live in `libs/persistence/src/entities/` and are re-exported from `libs/persistence/src/index.ts`. JSON columns use MikroORM's `type: 'json'` so the driver round-trips through `JSON.parse`/`JSON.stringify`. Composite keys are declared with multiple `@PrimaryKey()` decorators.

### 3.2.1 Shared types

`libs/persistence/src/entities/types.ts`

```ts
export enum VersioningState {
  Disabled = 'disabled',
  Enabled = 'enabled',
  Suspended = 'suspended',
}

export enum ObjectLockMode {
  Off = 'off',
  Governance = 'governance',
  Compliance = 'compliance',
}

export enum StorageClass {
  Standard = 'STANDARD',
  ReducedRedundancy = 'REDUCED_REDUNDANCY',
  StandardIA = 'STANDARD_IA',
  Glacier = 'GLACIER',
  DeepArchive = 'DEEP_ARCHIVE',
}

export interface ObjectLockBucketConfig {
  enabled: boolean;
  mode?: ObjectLockMode;
  defaultRetentionDays?: number;
}

export interface ObjectLockObjectState {
  mode: ObjectLockMode;
  retainUntil?: string; // ISO-8601
  legalHold?: boolean;
}

export interface EncryptionConfig {
  algorithm: 'AES256' | 'aws:kms' | null;
  kmsKeyId?: string;
}

export interface CorsRule {
  id?: string;
  allowedOrigins: string[];
  allowedMethods: ('GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD')[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface LifecycleRule {
  id: string;
  status: 'Enabled' | 'Disabled';
  prefix?: string;
  filter?: { tag?: { key: string; value: string }; sizeGreaterThan?: number; sizeLessThan?: number };
  expirationDays?: number;
  expiredObjectDeleteMarker?: boolean;
  noncurrentVersionExpirationDays?: number;
  abortIncompleteMultipartUploadDays?: number;
}

export interface PolicyDocument {
  Version: '2012-10-17';
  Statement: Array<{
    Sid?: string;
    Effect: 'Allow' | 'Deny';
    Principal: '*' | { AWS: string | string[] };
    Action: string | string[];
    Resource: string | string[];
    Condition?: Record<string, Record<string, string | string[]>>;
  }>;
}

export type TagSet = Record<string, string>;
```

### 3.2.2 `Bucket`

`libs/persistence/src/entities/bucket.entity.ts`

```ts
import { Collection, Entity, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import { ObjectEntity } from './object.entity';
import {
  CorsRule,
  EncryptionConfig,
  LifecycleRule,
  ObjectLockBucketConfig,
  PolicyDocument,
  TagSet,
  VersioningState,
} from './types';

@Entity({ tableName: 'buckets' })
export class Bucket {
  @PrimaryKey({ type: 'string', length: 63 })
  name!: string;

  @Property({ type: 'string', length: 32, default: 'us-east-1' })
  region: string = 'us-east-1';

  @Property({ type: 'string', default: VersioningState.Disabled })
  versioning: VersioningState = VersioningState.Disabled;

  @Property({ type: 'json', nullable: true })
  objectLock?: ObjectLockBucketConfig;

  @Property({ type: 'json', nullable: true })
  encryption?: EncryptionConfig;

  @Property({ type: 'json', nullable: true })
  cors?: CorsRule[];

  @Property({ type: 'json', nullable: true })
  lifecycle?: LifecycleRule[];

  @Property({ type: 'json', nullable: true })
  tagging?: TagSet;

  @Property({ type: 'json', nullable: true })
  policy?: PolicyDocument;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();

  @OneToMany(() => ObjectEntity, (o) => o.bucket)
  objects = new Collection<ObjectEntity>(this);
}
```

### 3.2.3 `ObjectEntity`

The "current pointer" row for a key. There is one row per `(bucket, key)`. When versioning is enabled, the body referenced by this row is also reachable via the matching `ObjectVersion` row.

`libs/persistence/src/entities/object.entity.ts`

```ts
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';
import { ObjectLockObjectState, StorageClass, TagSet } from './types';

@Entity({ tableName: 'objects' })
@Unique({ name: 'uq_objects_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_objects_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_objects_bucket_softdeleted', properties: ['bucket', 'softDeleted'] })
export class ObjectEntity {
  // Surrogate PK so the FK target is stable across renames. Composite
  // (bucket, key) is enforced by the unique constraint above.
  @PrimaryKey({ type: 'string' })
  id!: string; // uuid v7 — generated in service layer

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  /** versionId of the version currently reachable via the path-mirror filename. */
  @Property({ type: 'string', nullable: true })
  currentVersionId?: string;

  @Property({ type: 'bigint' })
  size: bigint = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType: string = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'json', nullable: true })
  tagging?: TagSet;

  @Property({ type: 'json', nullable: true })
  lock?: ObjectLockObjectState;

  @Property({ type: 'string', default: StorageClass.Standard })
  storageClass: StorageClass = StorageClass.Standard;

  @Property({ type: 'boolean', default: false })
  softDeleted: boolean = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();
}
```

### 3.2.4 `ObjectVersion`

When `Bucket.versioning` is `Enabled` or `Suspended`, every PUT writes a new `ObjectVersion` row and (for non-current versions) a new blob under `<key>.v/<versionId>`. Delete-markers are versions with `isDeleteMarker = true` and no blob on disk.

`libs/persistence/src/entities/object-version.entity.ts`

```ts
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';

@Entity({ tableName: 'object_versions' })
@Index({ name: 'ix_versions_bucket_key_version', properties: ['bucket', 'key', 'versionId'] })
@Index({ name: 'ix_versions_bucket_key_created', properties: ['bucket', 'key', 'createdAt'] })
export class ObjectVersion {
  @ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @PrimaryKey({ type: 'text' })
  key!: string;

  @PrimaryKey({ type: 'string', length: 64 })
  versionId!: string; // uuid v7

  @Property({ type: 'bigint' })
  size: bigint = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType: string = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'boolean', default: false })
  isDeleteMarker: boolean = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
```

### 3.2.5 `MultipartUpload` and `MultipartPart`

`libs/persistence/src/entities/multipart-upload.entity.ts`

```ts
import { Collection, Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';
import { MultipartPart } from './multipart-part.entity';
import { EncryptionConfig } from './types';

@Entity({ tableName: 'multipart_uploads' })
@Index({ name: 'ix_mpu_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_mpu_initiated', properties: ['initiatedAt'] })
export class MultipartUpload {
  @PrimaryKey({ type: 'string', length: 64 })
  uploadId!: string; // uuid v7

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  @Property({ type: 'string', length: 128, default: 'root' })
  initiator: string = 'root';

  @Property({ type: 'json', nullable: true })
  encryption?: EncryptionConfig;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType: string = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'datetime' })
  initiatedAt: Date = new Date();

  @OneToMany(() => MultipartPart, (p) => p.upload, { orphanRemoval: true })
  parts = new Collection<MultipartPart>(this);
}
```

`libs/persistence/src/entities/multipart-part.entity.ts`

```ts
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { MultipartUpload } from './multipart-upload.entity';

@Entity({ tableName: 'multipart_parts' })
@Index({ name: 'ix_mpp_upload_part', properties: ['upload', 'partNumber'] })
export class MultipartPart {
  @ManyToOne(() => MultipartUpload, { primary: true, fieldName: 'upload_id', deleteRule: 'cascade' })
  upload!: MultipartUpload;

  @PrimaryKey({ type: 'integer' })
  partNumber!: number; // 1..10000 per S3 contract

  @Property({ type: 'bigint' })
  size: bigint = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  /** Optional sha256 from x-amz-checksum-* trailers. */
  @Property({ type: 'string', length: 128, nullable: true })
  checksumSha256?: string;

  @Property({ type: 'datetime' })
  writtenAt: Date = new Date();
}
```

### 3.2.6 `AccessKey`

`libs/persistence/src/entities/access-key.entity.ts`

```ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'access_keys' })
export class AccessKey {
  @PrimaryKey({ type: 'string', length: 32 })
  accessKeyId!: string;

  /** argon2id hash of the secret. Never store the plaintext. */
  @Property({ type: 'string', length: 256 })
  secretHash!: string;

  @Property({ type: 'string', length: 128, default: '' })
  label: string = '';

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'boolean', default: false })
  disabled: boolean = false;
}
```

> **Note on the SigV4 path.** SigV4 verification requires recomputing HMACs from the *plaintext* secret — a one-way hash will not work for that. For v1 the root credentials are sourced from env (`ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`) and held in memory; only future *sub-keys* are stored hashed and used for non-S3 surfaces (e.g., admin API tokens). The `AccessKey` entity is shaped for that future. The `KeyService.getSecret` interface (§3.10) papers over this distinction.

### 3.2.7 `AdminUser`

`libs/persistence/src/entities/admin-user.entity.ts`

```ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'admin_users' })
export class AdminUser {
  @PrimaryKey({ type: 'string', length: 64 })
  username!: string;

  /** argon2id hash. Verified with argon2.verify(). */
  @Property({ type: 'string', length: 256 })
  passwordHash!: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
```

### 3.2.8 `RefreshToken`

`libs/persistence/src/entities/refresh-token.entity.ts`

```ts
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'refresh_tokens' })
@Index({ name: 'ix_refresh_subject', properties: ['subject'] })
@Index({ name: 'ix_refresh_expires', properties: ['expiresAt'] })
export class RefreshToken {
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string; // uuid v7 — also the JTI

  /** SHA-256 of the opaque token value. */
  @Property({ type: 'string', length: 128 })
  tokenHash!: string;

  @Property({ type: 'string', length: 64 })
  subject!: string;

  @Property({ type: 'datetime' })
  issuedAt: Date = new Date();

  @Property({ type: 'datetime' })
  expiresAt!: Date;

  /** Previous token id when this one was minted by rotation. */
  @Property({ type: 'string', length: 64, nullable: true })
  rotatedFrom?: string;
}
```

### 3.2.9 `LifecycleState`

`libs/persistence/src/entities/lifecycle-state.entity.ts`

```ts
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';

@Entity({ tableName: 'lifecycle_state' })
export class LifecycleState {
  @ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @PrimaryKey({ type: 'string', length: 64 })
  ruleId!: string;

  @Property({ type: 'datetime', nullable: true })
  lastSweepAt?: Date;

  /** Resume cursor — the last key fully processed during the previous tick. */
  @Property({ type: 'text', nullable: true })
  lastKeyProcessed?: string;
}
```

### 3.2.10 Barrel

`libs/persistence/src/index.ts`

```ts
export * from './entities/types';
export * from './entities/bucket.entity';
export * from './entities/object.entity';
export * from './entities/object-version.entity';
export * from './entities/multipart-upload.entity';
export * from './entities/multipart-part.entity';
export * from './entities/access-key.entity';
export * from './entities/admin-user.entity';
export * from './entities/refresh-token.entity';
export * from './entities/lifecycle-state.entity';
export * from './repositories/bucket.repository';
export * from './repositories/object.repository';
```

---

## 3.3 Migrations

### 3.3.1 Initial migration

Generated with `npm run orm:migration:create -- --initial`. The generator emits a class containing the `up`/`down` SQL. Below is the canonical content as it should appear on disk after generation — annotated and reformatted for clarity. Future migrations follow the same shape.

`apps/openbucket-backend/src/migrations/Migration20260520000001_initial.ts`

```ts
import { Migration } from '@mikro-orm/migrations';

export class Migration20260520000001_initial extends Migration {
  override async up(): Promise<void> {
    // ----- buckets ---------------------------------------------------------
    this.addSql(`
      create table "buckets" (
        "name"          text       not null primary key,
        "region"        text       not null default 'us-east-1',
        "versioning"    text       not null default 'disabled',
        "object_lock"   text       null,
        "encryption"    text       null,
        "cors"          text       null,
        "lifecycle"     text       null,
        "tagging"       text       null,
        "policy"        text       null,
        "created_at"    datetime   not null,
        "modified_at"   datetime   not null
      );
    `);

    // ----- objects ---------------------------------------------------------
    this.addSql(`
      create table "objects" (
        "id"                  text       not null primary key,
        "bucket_name"         text       not null,
        "key"                 text       not null,
        "current_version_id"  text       null,
        "size"                bigint     not null default 0,
        "etag"                text       not null,
        "content_type"        text       not null default 'application/octet-stream',
        "user_metadata"       text       null,
        "tagging"             text       null,
        "lock"                text       null,
        "storage_class"       text       not null default 'STANDARD',
        "soft_deleted"        boolean    not null default 0,
        "created_at"          datetime   not null,
        "modified_at"         datetime   not null,
        constraint "fk_objects_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create unique index "uq_objects_bucket_key" on "objects" ("bucket_name", "key");`);
    this.addSql(`create index "ix_objects_bucket_key" on "objects" ("bucket_name", "key");`);
    this.addSql(`create index "ix_objects_bucket_softdeleted" on "objects" ("bucket_name", "soft_deleted");`);

    // ----- object_versions -------------------------------------------------
    this.addSql(`
      create table "object_versions" (
        "bucket_name"      text       not null,
        "key"              text       not null,
        "version_id"       text       not null,
        "size"             bigint     not null default 0,
        "etag"             text       not null,
        "content_type"     text       not null default 'application/octet-stream',
        "user_metadata"    text       null,
        "is_delete_marker" boolean    not null default 0,
        "created_at"       datetime   not null,
        primary key ("bucket_name", "key", "version_id"),
        constraint "fk_versions_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create index "ix_versions_bucket_key_version" on "object_versions" ("bucket_name", "key", "version_id");`);
    this.addSql(`create index "ix_versions_bucket_key_created" on "object_versions" ("bucket_name", "key", "created_at");`);

    // ----- multipart_uploads ----------------------------------------------
    this.addSql(`
      create table "multipart_uploads" (
        "upload_id"     text       not null primary key,
        "bucket_name"   text       not null,
        "key"           text       not null,
        "initiator"     text       not null default 'root',
        "encryption"    text       null,
        "content_type"  text       not null default 'application/octet-stream',
        "user_metadata" text       null,
        "initiated_at"  datetime   not null,
        constraint "fk_mpu_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create index "ix_mpu_bucket_key" on "multipart_uploads" ("bucket_name", "key");`);
    this.addSql(`create index "ix_mpu_initiated" on "multipart_uploads" ("initiated_at");`);

    // ----- multipart_parts ------------------------------------------------
    this.addSql(`
      create table "multipart_parts" (
        "upload_id"        text       not null,
        "part_number"      integer    not null,
        "size"             bigint     not null default 0,
        "etag"             text       not null,
        "checksum_sha256"  text       null,
        "written_at"       datetime   not null,
        primary key ("upload_id", "part_number"),
        constraint "fk_mpp_upload"
          foreign key ("upload_id") references "multipart_uploads" ("upload_id") on delete cascade
      );
    `);
    this.addSql(`create index "ix_mpp_upload_part" on "multipart_parts" ("upload_id", "part_number");`);

    // ----- access_keys ----------------------------------------------------
    this.addSql(`
      create table "access_keys" (
        "access_key_id" text       not null primary key,
        "secret_hash"   text       not null,
        "label"         text       not null default '',
        "created_at"    datetime   not null,
        "disabled"      boolean    not null default 0
      );
    `);

    // ----- admin_users ----------------------------------------------------
    this.addSql(`
      create table "admin_users" (
        "username"      text       not null primary key,
        "password_hash" text       not null,
        "created_at"    datetime   not null
      );
    `);

    // ----- refresh_tokens -------------------------------------------------
    this.addSql(`
      create table "refresh_tokens" (
        "id"           text       not null primary key,
        "token_hash"   text       not null,
        "subject"      text       not null,
        "issued_at"    datetime   not null,
        "expires_at"   datetime   not null,
        "rotated_from" text       null
      );
    `);
    this.addSql(`create index "ix_refresh_subject" on "refresh_tokens" ("subject");`);
    this.addSql(`create index "ix_refresh_expires" on "refresh_tokens" ("expires_at");`);

    // ----- lifecycle_state ------------------------------------------------
    this.addSql(`
      create table "lifecycle_state" (
        "bucket_name"        text       not null,
        "rule_id"            text       not null,
        "last_sweep_at"      datetime   null,
        "last_key_processed" text       null,
        primary key ("bucket_name", "rule_id"),
        constraint "fk_lcs_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
  }

  /**
   * Down-migrations are emitted by the generator but are not part of the
   * supported operational story (see §3.3.2). Kept for tests only.
   */
  override async down(): Promise<void> {
    this.addSql('drop table if exists "lifecycle_state";');
    this.addSql('drop table if exists "refresh_tokens";');
    this.addSql('drop table if exists "admin_users";');
    this.addSql('drop table if exists "access_keys";');
    this.addSql('drop table if exists "multipart_parts";');
    this.addSql('drop table if exists "multipart_uploads";');
    this.addSql('drop table if exists "object_versions";');
    this.addSql('drop table if exists "objects";');
    this.addSql('drop table if exists "buckets";');
  }
}
```

### 3.3.2 Forward-only operational constraint

Production migrations run as part of container boot:

```ts
// apps/openbucket-backend/src/main.ts (excerpt — owned by backend-architect)
const orm = app.get(MikroORM);
await orm.getMigrator().up();
```

The forward-only constraint exists because:

1. SQLite has no per-row tombstoning of schema changes; a `DROP COLUMN` rewrites the table. Down-migrations on populated production volumes are slow and risky.
2. There is exactly one writer. Online dual-write schemes used in clustered databases do not apply.
3. The supported recovery path for "a bad migration shipped" is: restore the host-mounted volume from snapshot. This is consistent with the backup story described in `ARCHITECTURE.md` §11.

The `down()` method on each migration is preserved purely for unit-test convenience (test suites run `orm.schema.refreshDatabase()` between cases). It must not be invoked in production.

---

## 3.4 Repository pattern

MikroORM gives every entity a default `EntityRepository<T>`. Custom repositories are added only where they earn the abstraction — typically for query helpers that would otherwise be inlined into services. `BucketRepository` and `ObjectRepository` are the two that justify their existence in v1.

### 3.4.1 `BucketRepository`

`libs/persistence/src/repositories/bucket.repository.ts`

```ts
import { EntityRepository } from '@mikro-orm/better-sqlite';
import { Bucket } from '../entities/bucket.entity';
import { VersioningState } from '../entities/types';

export class BucketRepository extends EntityRepository<Bucket> {
  /** Resolve a bucket by name with strict null. Used by every S3 handler. */
  async getByName(name: string): Promise<Bucket | null> {
    return this.findOne({ name });
  }

  /** Existence check — cheaper than fetching the full row. */
  async exists(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['name'] });
    return row !== null;
  }

  /** True when the bucket emits version ids on writes. */
  async isVersioned(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['versioning'] });
    return row?.versioning === VersioningState.Enabled;
  }

  /** True when the bucket has versioning either Enabled or Suspended. */
  async hasVersionHistory(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['versioning'] });
    return row?.versioning !== VersioningState.Disabled;
  }

  /** ListBuckets admin-API helper. */
  async listAll(): Promise<Bucket[]> {
    return this.findAll({ orderBy: { name: 'ASC' } });
  }
}
```

### 3.4.2 `ObjectRepository`

The `listByPrefix` method backs `ListObjectsV2`. It deliberately uses raw SQL via the Knex query builder exposed by MikroORM — paginated prefix scans want indexed range predicates, not a generic `LIKE` that defeats the index.

`libs/persistence/src/repositories/object.repository.ts`

```ts
import { EntityRepository } from '@mikro-orm/better-sqlite';
import { ObjectEntity } from '../entities/object.entity';
import { ObjectVersion } from '../entities/object-version.entity';

export interface ListPage {
  items: ObjectEntity[];
  isTruncated: boolean;
  nextMarker?: string;
  commonPrefixes: string[];
}

export class ObjectRepository extends EntityRepository<ObjectEntity> {
  /**
   * Resolve the current pointer row for (bucket, key). Returns null if the
   * key has never existed in this bucket or if the pointer is soft-deleted.
   */
  async findCurrentVersion(bucket: string, key: string): Promise<ObjectEntity | null> {
    return this.findOne(
      { bucket: { name: bucket }, key, softDeleted: false },
      { populate: ['bucket'] },
    );
  }

  /**
   * Paginated, prefix-scoped list. Implements S3 ListObjectsV2 semantics:
   *   - prefix:   string filter on key (range scan, not LIKE)
   *   - marker:   exclusive lower bound (StartAfter / ContinuationToken)
   *   - delimiter: optional grouping char — caller passes through; the SQL
   *                returns a flat list and the service computes CommonPrefixes
   *                in memory. The SQL still uses the marker for pagination.
   *   - limit:    MaxKeys + 1 to detect truncation
   *
   * Keys are stored raw (UTF-8). SQLite compares blob-equal under BINARY
   * collation, which is what S3 specifies (byte-wise lex order).
   */
  async listByPrefix(
    bucket: string,
    prefix: string,
    marker: string | undefined,
    limit: number,
  ): Promise<{ rows: ObjectEntity[]; truncated: boolean }> {
    const qb = this.createQueryBuilder('o')
      .select('*')
      .where({ bucket: bucket, softDeleted: false });

    if (prefix.length > 0) {
      // Range scan: prefix <= key < prefix + U+FFFF-equivalent. The upper
      // bound is the prefix with its last code unit incremented; if that's
      // impossible (e.g. prefix ends in 0xFF), append a sentinel byte.
      const upper = nextStringBound(prefix);
      qb.andWhere({ key: { $gte: prefix, $lt: upper } });
    }

    if (marker !== undefined && marker.length > 0) {
      qb.andWhere({ key: { $gt: marker } });
    }

    qb.orderBy({ key: 'ASC' }).limit(limit + 1);

    const all = await qb.getResult();
    return {
      rows: all.slice(0, limit),
      truncated: all.length > limit,
    };
  }

  /** ListObjectVersions support — flat scan of the versions table by prefix. */
  async listVersionsByPrefix(
    bucket: string,
    prefix: string,
    keyMarker: string | undefined,
    versionMarker: string | undefined,
    limit: number,
  ): Promise<ObjectVersion[]> {
    const em = this.getEntityManager();
    const qb = em.createQueryBuilder(ObjectVersion, 'v')
      .select('*')
      .where({ bucket: bucket });

    if (prefix.length > 0) {
      const upper = nextStringBound(prefix);
      qb.andWhere({ key: { $gte: prefix, $lt: upper } });
    }
    if (keyMarker !== undefined) {
      if (versionMarker !== undefined) {
        qb.andWhere({
          $or: [
            { key: { $gt: keyMarker } },
            { $and: [{ key: keyMarker }, { versionId: { $gt: versionMarker } }] },
          ],
        });
      } else {
        qb.andWhere({ key: { $gt: keyMarker } });
      }
    }

    qb.orderBy({ key: 'ASC', createdAt: 'DESC' }).limit(limit + 1);
    return qb.getResult();
  }

  /** Returns the most recent non-current version for (bucket, key). */
  async findLatestVersion(bucket: string, key: string): Promise<ObjectVersion | null> {
    const em = this.getEntityManager();
    return em.findOne(
      ObjectVersion,
      { bucket: bucket, key },
      { orderBy: { createdAt: 'DESC' } },
    );
  }
}

/**
 * Compute the exclusive upper bound for a prefix range scan over UTF-8 keys.
 * Returns the smallest string greater than every string with `prefix` as a
 * prefix. Walks back from the end incrementing the first non-0xFF code unit.
 * If the entire prefix is 0xFF runs, falls back to appending 0x00 to a copy
 * that's one code unit longer — guaranteed larger than any string with that
 * prefix because SQLite BINARY comparison is byte-wise.
 */
function nextStringBound(prefix: string): string {
  const bytes = Buffer.from(prefix, 'utf8');
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] < 0xff) {
      const out = Buffer.from(bytes.subarray(0, i + 1));
      out[i] = out[i] + 1;
      return out.toString('binary'); // pass-through byte string
    }
  }
  return prefix + '￿';
}
```

The `listByPrefix` method is the workhorse behind every `ListObjectsV2` request. The service layer composes the `commonPrefixes` set in memory by scanning the result rows for the delimiter substring after the `prefix`. That decomposition lets the SQL stay simple and indexable.

---

## 3.5 Key encoding

S3 keys are arbitrary UTF-8 byte sequences of length 1–1024. The filesystem cannot host all of them safely (path separators, hidden files, Windows reserved characters, length caps). The encoder lives at the storage boundary only; SQLite stores raw keys.

`apps/openbucket-backend/src/storage/key-codec.ts`

```ts
/**
 * Filesystem-safe encoding of S3 keys to path-mirror filenames.
 *
 * Pass-through:   A-Z a-z 0-9 - _ . ~
 * Preserved:      /   (S3 "folder" convention — keys form directory trees)
 * Encoded:        everything else, byte-wise as %XX (UTF-8 bytes)
 *
 * Special cases per segment (between '/' characters):
 *   - leading '.'   → %2E  (avoid Unix hidden files)
 *   - trailing '.'  → %2E  (Windows quirk)
 *   - trailing ' '  → %20  (Windows quirk)
 *   - segment length cap: 255 bytes — throws KeyTooLongError
 */

export class KeyTooLongError extends Error {
  override readonly name = 'KeyTooLongError';
  constructor(readonly segment: string, readonly maxBytes = 255) {
    super(`encoded key segment exceeds ${maxBytes} bytes`);
  }
}

const UNRESERVED = new Set<number>();
(() => {
  const ranges: [number, number][] = [
    [0x30, 0x39], // 0-9
    [0x41, 0x5a], // A-Z
    [0x61, 0x7a], // a-z
  ];
  for (const [lo, hi] of ranges) {
    for (let c = lo; c <= hi; c++) UNRESERVED.add(c);
  }
  for (const ch of '-_.~') UNRESERVED.add(ch.charCodeAt(0));
})();

const HEX = '0123456789ABCDEF';

function encodeByte(b: number): string {
  return '%' + HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
}

function encodeSegment(segment: string): string {
  if (segment.length === 0) return ''; // double-slash path component
  const bytes = Buffer.from(segment, 'utf8');
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (UNRESERVED.has(b)) {
      out += String.fromCharCode(b);
    } else {
      out += encodeByte(b);
    }
  }

  // Leading dot becomes %2E so the directory entry is not a "hidden file"
  // on POSIX listings and so dotfile-skipping tooling doesn't miss it.
  if (out.startsWith('.')) {
    out = '%2E' + out.slice(1);
  }

  // Trailing dot or space: Windows can't host these as filenames. We're on
  // Linux in prod, but the encoding is forward-compatible.
  const last = out[out.length - 1];
  if (last === '.') {
    out = out.slice(0, -1) + '%2E';
  } else if (last === ' ') {
    out = out.slice(0, -1) + '%20';
  }

  if (Buffer.byteLength(out, 'utf8') > 255) {
    throw new KeyTooLongError(segment);
  }
  return out;
}

/**
 * Encode a full key into a filesystem-safe relative path. The '/' character
 * is preserved as a path separator. Other characters are encoded per-segment.
 */
export function encodeKey(key: string): string {
  if (key.length === 0) {
    throw new Error('empty key is not encodable');
  }
  const segments = key.split('/');
  return segments.map(encodeSegment).join('/');
}

/**
 * Decode a path-mirror filename back to a raw key. Used only for diagnostics
 * and the orphan-blob scan — the hot path reads keys from SQLite, never from
 * disk. Tolerant of malformed input: invalid %XX sequences pass through.
 */
export function decodeKey(encoded: string): string {
  const segments = encoded.split('/');
  return segments.map(decodeSegment).join('/');
}

function decodeSegment(segment: string): string {
  if (segment.length === 0) return '';
  const out: number[] = [];
  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);
    if (ch === 0x25 /* % */ && i + 2 < segment.length) {
      const hi = parseHex(segment.charCodeAt(i + 1));
      const lo = parseHex(segment.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out.push((hi << 4) | lo);
        i += 2;
        continue;
      }
    }
    out.push(ch);
  }
  return Buffer.from(out).toString('utf8');
}

function parseHex(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}
```

### 3.5.1 Unit tests

Co-located: `apps/openbucket-backend/src/storage/key-codec.spec.ts`

```ts
import { describe, expect, it } from '@jest/globals';
import { decodeKey, encodeKey, KeyTooLongError } from './key-codec';

describe('encodeKey / decodeKey', () => {
  const roundtrip = (raw: string) => {
    const encoded = encodeKey(raw);
    expect(decodeKey(encoded)).toBe(raw);
  };

  describe('pass-through', () => {
    it('ASCII alphanumerics are unchanged', () => {
      expect(encodeKey('hello-world_123.txt')).toBe('hello-world_123.txt');
    });

    it('unreserved RFC3986 chars survive', () => {
      expect(encodeKey('a-b_c.d~e')).toBe('a-b_c.d~e');
    });

    it('preserves / as path separator', () => {
      expect(encodeKey('photos/2026/may.jpg')).toBe('photos/2026/may.jpg');
    });
  });

  describe('percent-encoding', () => {
    it('encodes space as %20', () => {
      expect(encodeKey('my file.txt')).toBe('my%20file.txt');
    });

    it('encodes question mark and ampersand', () => {
      expect(encodeKey('a?b&c=d')).toBe('a%3Fb%26c%3Dd');
    });

    it('encodes UTF-8 multi-byte sequences byte-wise', () => {
      // U+00E9 = 0xC3 0xA9 ; U+1F600 = 0xF0 0x9F 0x98 0x80
      expect(encodeKey('cafeé.txt')).toBe('cafe%C3%A9.txt');
      expect(encodeKey('emoji\u{1F600}')).toBe('emoji%F0%9F%98%80');
    });

    it('encodes control characters', () => {
      expect(encodeKey('a\nb\tc')).toBe('a%0Ab%09c');
    });
  });

  describe('hidden / quirky segments', () => {
    it('rewrites leading dot to %2E', () => {
      expect(encodeKey('.htaccess')).toBe('%2Ehtaccess');
    });

    it('rewrites leading dot in inner segment', () => {
      expect(encodeKey('a/.b/c')).toBe('a/%2Eb/c');
    });

    it('rewrites trailing dot to %2E', () => {
      expect(encodeKey('foo.')).toBe('foo%2E');
    });

    it('rewrites trailing space to %20', () => {
      expect(encodeKey('foo ')).toBe('foo%20');
    });

    it('handles leading-and-trailing-dot segment', () => {
      // leading dot rule fires first; trailing dot rule fires next.
      expect(encodeKey('.hidden.')).toBe('%2Ehidden%2E');
    });
  });

  describe('length cap', () => {
    it('rejects segments whose encoded form exceeds 255 bytes', () => {
      // Each multi-byte UTF-8 char inflates 3x under %XX. 90 emoji = 360 bytes.
      const segment = '\u{1F600}'.repeat(90);
      expect(() => encodeKey(segment)).toThrow(KeyTooLongError);
    });

    it('accepts a 255-byte segment exactly', () => {
      const segment = 'a'.repeat(255);
      expect(encodeKey(segment)).toBe(segment);
    });
  });

  describe('roundtrip', () => {
    it.each([
      'simple.txt',
      'photos/2026/05/20/cat.jpg',
      'my file with spaces.bin',
      'a?b&c=d',
      'cafeé.txt',
      'a\nb',
      '.htaccess',
      'trailing.',
      'trailing ',
      '\u{1F4A9}\u{1F600}.bin',
    ])('roundtrips %j', roundtrip);
  });

  describe('edge cases', () => {
    it('rejects empty key', () => {
      expect(() => encodeKey('')).toThrow(/empty key/);
    });

    it('preserves consecutive slashes as empty segments', () => {
      expect(encodeKey('a//b')).toBe('a//b');
      expect(decodeKey('a//b')).toBe('a//b');
    });

    it('decode tolerates malformed % escapes', () => {
      expect(decodeKey('a%ZZ')).toBe('a%ZZ');
      expect(decodeKey('a%')).toBe('a%');
    });
  });
});
```

The S3 controller layer (owned by the S3 agent) catches `KeyTooLongError` thrown from any service that constructs a storage path and maps it to `HTTP 400 KeyTooLongError` — the AWS code for over-long keys.

---

## 3.6 BlobStore

The `BlobStore` is the single point of contact between domain services and the host filesystem. It owns:

- atomic stage-and-rename semantics (writes never appear at their final path partially),
- per-object hashing during ingestion (no second pass),
- `EXDEV` fallback for the rare case where `tmp/` and `blobs/` ended up on different devices,
- soft-delete via trash relocation,
- multipart composition (parts → final).

It does **not** own stream lifecycles (abort cleanup, backpressure tuning) — those belong to the streaming agent, which consumes the signatures below.

### 3.6.1 Path resolver

`apps/openbucket-backend/src/storage/paths.ts`

```ts
import { join } from 'node:path';
import { encodeKey } from './key-codec';

export class PathResolver {
  constructor(private readonly dataDir: string) {}

  blobsDir(): string {
    return join(this.dataDir, 'blobs');
  }
  bucketDir(bucket: string): string {
    return join(this.blobsDir(), bucket);
  }
  blobPath(bucket: string, key: string): string {
    return join(this.bucketDir(bucket), encodeKey(key));
  }
  versionDir(bucket: string, key: string): string {
    return this.blobPath(bucket, key) + '.v';
  }
  versionPath(bucket: string, key: string, versionId: string): string {
    return join(this.versionDir(bucket, key), versionId);
  }
  multipartDir(uploadId: string): string {
    return join(this.dataDir, 'multipart', uploadId);
  }
  multipartPartPath(uploadId: string, partNumber: number): string {
    return join(this.multipartDir(uploadId), `${partNumber}.part`);
  }
  tmpDir(): string {
    return join(this.dataDir, 'tmp');
  }
  tmpPath(name: string): string {
    return join(this.tmpDir(), name);
  }
  trashDir(): string {
    return join(this.dataDir, 'trash');
  }
}
```

### 3.6.2 `BlobStore` — interface and implementation

`apps/openbucket-backend/src/storage/blob-store.ts`

```ts
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  promises as fs,
  ReadStream,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolver } from './paths';

export interface PutResult {
  /** Bytes written, post-flush. */
  size: bigint;
  /** Hex MD5 — the canonical S3 ETag for single-part objects. */
  etag: string;
  /** Hex SHA-256 — for x-amz-content-sha256 verification. */
  sha256: string;
  /** Final on-disk path after rename. */
  finalPath: string;
}

export interface RangeSpec {
  /** Inclusive byte offset. */
  start: number;
  /** Inclusive byte offset, or undefined to read through EOF. */
  end?: number;
}

export interface HeadResult {
  size: bigint;
  mtime: Date;
}

export interface BlobRef {
  path: string;
  size: bigint;
}

@Injectable()
export class BlobStore {
  private readonly log = new Logger(BlobStore.name);
  private readonly paths: PathResolver;

  constructor(config: ConfigService) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Stage a blob in tmp/, compute its hashes while streaming, then atomically
   * rename to its final destination. Returns size + hashes + final path.
   *
   * `source` may be a Readable (request body) or an absolute filesystem path
   * (used internally by composeBlobs and the multipart finaliser).
   *
   * Stream lifecycle (abort, backpressure) is the caller's responsibility —
   * the streaming agent wires AbortSignal handling around this method.
   */
  async putBlob(
    bucket: string,
    key: string,
    source: Readable | string,
  ): Promise<PutResult> {
    await this.ensureDir(this.paths.tmpDir());
    const tmpName = `put-${randomUUID()}`;
    const tmpPath = this.paths.tmpPath(tmpName);
    const finalPath = this.paths.blobPath(bucket, key);

    const md5 = createHash('md5');
    const sha = createHash('sha256');
    let bytesWritten = 0n;

    const sink = createWriteStream(tmpPath, { flags: 'wx' });
    const input: Readable = typeof source === 'string' ? createReadStream(source) : source;

    try {
      // We hash inline by tapping the source. pipeline propagates errors and
      // tears down both streams on abort.
      input.on('data', (chunk: Buffer) => {
        md5.update(chunk);
        sha.update(chunk);
        bytesWritten += BigInt(chunk.length);
      });
      await pipeline(input, sink);
      // fsync the file so the rename actually buys us durability.
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.ensureDir(dirname(finalPath));
    await this.atomicRename(tmpPath, finalPath);

    return {
      size: bytesWritten,
      etag: md5.digest('hex'),
      sha256: sha.digest('hex'),
      finalPath,
    };
  }

  /**
   * Open a read stream for the blob at (bucket, key), optionally constrained
   * to a byte range. The returned `stream` is a `fs.ReadStream` so callers
   * can wire `.on('error')` and abort it.
   *
   * Throws ENOENT-equivalent if the blob is missing — caller maps to NoSuchKey.
   */
  async getBlob(
    bucket: string,
    key: string,
    range?: RangeSpec,
  ): Promise<{ stream: ReadStream; size: bigint }> {
    const path = this.paths.blobPath(bucket, key);
    const stat = await fs.stat(path);
    const opts: { start?: number; end?: number } = {};
    if (range) {
      opts.start = range.start;
      if (range.end !== undefined) opts.end = range.end;
    }
    const stream = createReadStream(path, opts);
    return { stream, size: BigInt(stat.size) };
  }

  /**
   * Stat-only — used by HEAD requests where the body isn't needed. Returns
   * null on ENOENT so callers don't have to catch.
   */
  async headBlob(bucket: string, key: string): Promise<HeadResult | null> {
    try {
      const stat = await fs.stat(this.paths.blobPath(bucket, key));
      return { size: BigInt(stat.size), mtime: stat.mtime };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Soft-delete: move the blob into trash/ with a manifest entry. The actual
   * unlink happens in the trash purge background tick (streaming agent).
   */
  async deleteBlob(bucket: string, key: string): Promise<void> {
    const src = this.paths.blobPath(bucket, key);
    await this.ensureDir(this.paths.trashDir());

    const entryId = randomUUID();
    const dst = join(this.paths.trashDir(), entryId);

    try {
      await this.atomicRename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Already gone — idempotent.
        return;
      }
      throw err;
    }

    const manifest = {
      entryId,
      bucket,
      key,
      originalPath: src,
      deletedAt: new Date().toISOString(),
    };
    await fs.writeFile(`${dst}.manifest.json`, JSON.stringify(manifest, null, 2));
  }

  /**
   * Concatenate `parts` into a single blob at (destBucket, destKey). Used by
   * CompleteMultipartUpload. The composed file is staged in tmp/ and renamed,
   * preserving the same atomicity guarantee as putBlob.
   *
   * Hashing: MD5 is recomputed over the concatenated content for the final
   * ETag (note: S3 reports a different ETag format for multipart objects —
   * "<md5-of-concatenated-part-md5s>-<partCount>". The service layer derives
   * that from per-part ETags; this method returns the raw single-blob MD5.)
   */
  async composeBlobs(
    parts: BlobRef[],
    destBucket: string,
    destKey: string,
  ): Promise<PutResult> {
    await this.ensureDir(this.paths.tmpDir());
    const tmpName = `compose-${randomUUID()}`;
    const tmpPath = this.paths.tmpPath(tmpName);
    const finalPath = this.paths.blobPath(destBucket, destKey);

    const md5 = createHash('md5');
    const sha = createHash('sha256');
    let bytesWritten = 0n;

    const sink = createWriteStream(tmpPath, { flags: 'wx' });
    try {
      for (const part of parts) {
        const partStream = createReadStream(part.path);
        partStream.on('data', (chunk: Buffer) => {
          md5.update(chunk);
          sha.update(chunk);
          bytesWritten += BigInt(chunk.length);
        });
        // pipe but don't close the sink between parts
        await new Promise<void>((resolve, reject) => {
          partStream.on('error', reject);
          partStream.on('end', resolve);
          partStream.pipe(sink, { end: false });
        });
      }
      // Now end the sink and fsync.
      await new Promise<void>((resolve, reject) => {
        sink.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.ensureDir(dirname(finalPath));
    await this.atomicRename(tmpPath, finalPath);
    return {
      size: bytesWritten,
      etag: md5.digest('hex'),
      sha256: sha.digest('hex'),
      finalPath,
    };
  }

  // ----- internals -------------------------------------------------------

  private async ensureDir(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true });
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch {
      /* ignore — best-effort cleanup */
    }
  }

  private async fsyncFile(path: string): Promise<void> {
    const fh = await fs.open(path, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  /**
   * rename(2) is atomic only on the same filesystem. If tmp/ and the
   * destination live on different mounts (operator misconfiguration or
   * containerised volumes), Node returns EXDEV. Fall back to copy+unlink —
   * not atomic, but correct under the constraint, and noisy in the log so
   * the operator notices.
   */
  private async atomicRename(src: string, dst: string): Promise<void> {
    try {
      await fs.rename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      this.log.warn(
        `EXDEV: ${src} -> ${dst} is cross-device. Falling back to copy+unlink. ` +
          'Check that DATA_DIR/tmp and DATA_DIR/blobs share a mount.',
      );
      await fs.copyFile(src, dst);
      await this.unlinkQuiet(src);
    }
  }
}
```

### 3.6.3 Contracts for the streaming agent

These are the function signatures the streaming agent must consume. They are stable.

```ts
putBlob(bucket: string, key: string, source: Readable | string): Promise<PutResult>;
getBlob(bucket: string, key: string, range?: RangeSpec): Promise<{ stream: ReadStream; size: bigint }>;
headBlob(bucket: string, key: string): Promise<HeadResult | null>;
deleteBlob(bucket: string, key: string): Promise<void>;
composeBlobs(parts: BlobRef[], destBucket: string, destKey: string): Promise<PutResult>;
```

The streaming agent owns: piping `IncomingMessage` into `putBlob` with `AbortController` wiring, `Range` header parsing into `RangeSpec`, `Content-Range`/`206` response headers around `getBlob`, and the trash-purge background tick that walks `trash/*.manifest.json` and unlinks expired entries.

---

## 3.7 Two-phase commit pattern

A successful object write has two artefacts: a file on disk and a row in SQLite. Either alone is incomplete. The canonical sequence ensures that the row is never written before the file is durable, so a crash never leaves a row pointing at non-existent bytes.

### 3.7.1 Canonical write flow

```
Client                Service              BlobStore           EM/SQLite       Filesystem
  |  PUT (stream)        |                    |                    |               |
  |--------------------->|                    |                    |               |
  |                      | em.begin()         |                    |               |
  |                      |-------------------------------------- ->|               |
  |                      |                    |                    |               |
  |                      | putBlob(stream) -> | (1) open tmp file -|-----[wx]----->|
  |                      |                    | (2) stream + hash  |               |
  |                      |                    | (3) fsync           |               |
  |                      |                    | (4) rename tmp -> final ---------->|
  |                      |<-- {size,etag,…} --|                    |               |
  |                      |                    |                    |               |
  |                      | em.upsert(ObjectEntity { …, etag, size, …})              |
  |                      |-------------------------------------- ->|               |
  |                      | em.commit()                              |               |
  |                      |-------------------------------------- ->|               |
  |                      |                                          | fsync wal     |
  |                      |<------------------ OK -------------------|               |
  |<------- 200 ---------|                                          |               |
```

### 3.7.2 Reference implementation

`apps/openbucket-backend/src/storage/object-writer.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BlobStore } from './blob-store';
import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  StorageClass,
  VersioningState,
} from '@openbucket/persistence';

export interface PutObjectCmd {
  bucket: string;
  key: string;
  body: Readable;
  contentType?: string;
  userMetadata?: Record<string, string>;
}

@Injectable()
export class ObjectWriterService {
  private readonly log = new Logger(ObjectWriterService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly blobs: BlobStore,
  ) {}

  /**
   * The canonical two-phase write. Order is fixed:
   *   1. Open transaction (no SQL issued yet)
   *   2. Stage blob in tmp/  (BlobStore.putBlob)
   *   3. Atomic rename to final path  (still inside putBlob)
   *   4. Insert/update ObjectEntity row
   *   5. Commit transaction
   *   6. On failure after step 3: best-effort unlink of the renamed file.
   *
   * The crash window: post-rename, pre-commit (between steps 3 and 5). A
   * power loss here leaves an orphan blob — reconciled by §3.8.
   */
  async put(cmd: PutObjectCmd): Promise<ObjectEntity> {
    const em = this.em.fork();
    await em.begin();

    let finalPath: string | undefined;
    try {
      // Step 2 + 3: stage + atomic rename. After this returns, the file
      // already lives at its final location.
      const put = await this.blobs.putBlob(cmd.bucket, cmd.key, cmd.body);
      finalPath = put.finalPath;

      const bucket = await em.findOneOrFail(Bucket, { name: cmd.bucket });

      // Step 4: upsert the pointer row.
      let row = await em.findOne(ObjectEntity, {
        bucket: { name: cmd.bucket },
        key: cmd.key,
      });
      if (!row) {
        row = new ObjectEntity();
        row.id = randomUUID();
        row.bucket = bucket;
        row.key = cmd.key;
      }
      row.size = put.size;
      row.etag = put.etag;
      row.contentType = cmd.contentType ?? 'application/octet-stream';
      row.userMetadata = cmd.userMetadata;
      row.storageClass = StorageClass.Standard;
      row.softDeleted = false;
      row.modifiedAt = new Date();

      // Versioning side-effects (see §3.11 for full treatment).
      if (bucket.versioning !== VersioningState.Disabled) {
        const versionId = randomUUID();
        row.currentVersionId = versionId;

        const ver = em.create(ObjectVersion, {
          bucket,
          key: cmd.key,
          versionId,
          size: put.size,
          etag: put.etag,
          contentType: row.contentType,
          userMetadata: row.userMetadata,
          isDeleteMarker: false,
          createdAt: new Date(),
        });
        em.persist(ver);
      }

      em.persist(row);
      // Step 5: commit. May throw on constraint failure.
      await em.commit();
      return row;
    } catch (err) {
      // Step 6: rollback row state. Then unlink the file we just promoted,
      // best-effort — if this fails the orphan scan will eventually find it.
      await em.rollback().catch(() => undefined);
      if (finalPath) {
        try {
          await fs.unlink(finalPath);
        } catch (unlinkErr) {
          this.log.warn(
            `failed to clean up post-rename file after commit error: ${finalPath}: ${(unlinkErr as Error).message}`,
          );
        }
      }
      throw err;
    }
  }
}
```

### 3.7.3 The crash window

There is exactly one window where state can diverge: between the successful `rename()` (step 3) and a successful commit (step 5). Loss of power, OOM-kill, or container restart in that window leaves:

- A file at `<DATA_DIR>/blobs/<bucket>/<encoded-key>` — durable, fsync'd.
- No corresponding row in `objects`.

This is an **orphan blob**. It is harmless — it cannot be read because no metadata references it — but it occupies disk. The orphan scan in §3.8 finds and logs these. v1 does not auto-delete; an operator can run the scan in repair mode (a future flag) to remove them.

The reverse failure — row committed, file missing — is **prevented by construction**. The row is never written until after rename succeeds.

---

## 3.8 Crash recovery & orphan scan

Runs once at startup, before the HTTP server begins accepting requests. Two passes:

1. **Blob scan**: walk `blobs/`, compare each file to the `objects` table. Orphans logged.
2. **Multipart scan**: walk `multipart/`, compare each `<upload-id>` directory to the `multipart_uploads` table. Directories without a row are deleted (they cannot be resumed — the upload state is gone).

`apps/openbucket-backend/src/storage/recovery.service.ts`

```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PathResolver } from './paths';
import { decodeKey } from './key-codec';
import { MultipartUpload, ObjectEntity } from '@openbucket/persistence';

interface OrphanReport {
  orphanBlobs: { path: string; bucket: string; key: string }[];
  removedMultipartDirs: string[];
  scanned: { blobs: number; multipart: number };
}

@Injectable()
export class RecoveryService implements OnApplicationBootstrap {
  private readonly log = new Logger(RecoveryService.name);
  private readonly paths: PathResolver;

  constructor(
    private readonly em: EntityManager,
    config: ConfigService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  async onApplicationBootstrap(): Promise<void> {
    const t0 = Date.now();
    const report = await this.runScan();
    this.log.log(
      `recovery scan: ${report.scanned.blobs} blobs, ${report.scanned.multipart} multipart dirs ` +
        `in ${Date.now() - t0}ms; ${report.orphanBlobs.length} orphan blobs, ` +
        `${report.removedMultipartDirs.length} stale multipart dirs cleaned`,
    );
    if (report.orphanBlobs.length > 0) {
      // Log first 50 paths so an operator can investigate without grepping
      // through the filesystem manually.
      for (const o of report.orphanBlobs.slice(0, 50)) {
        this.log.warn(`orphan blob: bucket=${o.bucket} key=${o.key} path=${o.path}`);
      }
    }
  }

  async runScan(): Promise<OrphanReport> {
    const orphanBlobs: OrphanReport['orphanBlobs'] = [];
    const removedMultipartDirs: string[] = [];
    let blobsScanned = 0;
    let multipartScanned = 0;

    // ----- blob pass -----------------------------------------------------
    const blobsRoot = this.paths.blobsDir();
    if (await this.exists(blobsRoot)) {
      const bucketDirs = await fs.readdir(blobsRoot, { withFileTypes: true });
      for (const bucketDirent of bucketDirs) {
        if (!bucketDirent.isDirectory()) continue;
        const bucket = bucketDirent.name;
        const bucketRoot = join(blobsRoot, bucket);
        for await (const filePath of this.walk(bucketRoot)) {
          blobsScanned++;
          // Skip version-store directories — they're reconciled via
          // ObjectVersion rows.  *.v/ paths and trash-shaped paths are
          // ignored here; the version reconciliation pass below handles them.
          const rel = relative(bucketRoot, filePath);
          if (rel.includes('.v' + '/') || rel.includes('.v' + '\\')) continue;

          const decoded = decodeKey(rel.replaceAll('\\', '/'));
          const row = await this.em.findOne(
            ObjectEntity,
            { bucket: { name: bucket }, key: decoded },
            { fields: ['id'] },
          );
          if (!row) {
            orphanBlobs.push({ path: filePath, bucket, key: decoded });
          }
        }
      }
    }

    // ----- multipart pass ------------------------------------------------
    const multipartRoot = join(this.paths['dataDir' as never] as never, 'multipart');
    // Resolve via PathResolver instead of poking private state:
    const mpRoot = this.paths.multipartDir('').slice(0, -1); // strip trailing sep
    if (await this.exists(mpRoot)) {
      const uploadDirs = await fs.readdir(mpRoot, { withFileTypes: true });
      for (const d of uploadDirs) {
        if (!d.isDirectory()) continue;
        multipartScanned++;
        const uploadId = d.name;
        const row = await this.em.findOne(
          MultipartUpload,
          { uploadId },
          { fields: ['uploadId'] },
        );
        if (!row) {
          const dirPath = join(mpRoot, uploadId);
          await fs.rm(dirPath, { recursive: true, force: true });
          removedMultipartDirs.push(dirPath);
        }
      }
    }

    return {
      orphanBlobs,
      removedMultipartDirs,
      scanned: { blobs: blobsScanned, multipart: multipartScanned },
    };
  }

  private async *walk(root: string): AsyncIterable<string> {
    const stack: string[] = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(p);
        } else if (ent.isFile()) {
          yield p;
        }
      }
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

The scan never auto-deletes orphan blobs in v1. The rationale: a misconfigured `DATA_DIR` (operator points the container at the wrong volume) would otherwise nuke real data. Logging is the safe default. A future `--repair` mode can unlink them after a confirmation prompt.

---

## 3.9 Trash management

Soft-delete is implemented by relocating a blob into `<DATA_DIR>/trash/<uuid>` with a sibling JSON manifest at `<DATA_DIR>/trash/<uuid>.manifest.json`. The metadata row is updated separately by the service layer (typically `softDeleted = true` on `ObjectEntity`, or a delete-marker `ObjectVersion` row, depending on versioning state).

**Manifest schema** (one file per trash entry):

```ts
interface TrashManifest {
  entryId: string;          // matches the trash filename
  bucket: string;           // raw bucket name
  key: string;              // raw S3 key
  originalPath: string;     // absolute path the blob was renamed from
  deletedAt: string;        // ISO-8601
  scheduledPurgeAt?: string;// ISO-8601 — set by lifecycle service when applicable
}
```

Writing the manifest happens **after** the blob is renamed into trash. If the manifest write fails, the file remains in trash without a manifest — the purge tick treats unmanifested trash files as "purge after grace period" with a configurable default grace.

The actual purge — walking `trash/*.manifest.json`, comparing `scheduledPurgeAt` to `Date.now()`, and unlinking — runs on the background tick owned by the streaming agent. This module provides only the move-to-trash operation, which is `BlobStore.deleteBlob` (§3.6.2).

There is no SQLite table for trash entries in v1. The filesystem is the source of truth, and the manifest doubles as the record. Adding a `trash` table later (for fast counting / listing in the admin UI) is a forward-compatible change.

---

## 3.10 `KeyService.getSecret` interface

The SigV4 guard owned by the S3 agent needs to recover the plaintext secret for an `accessKeyId`. v1 has exactly one root key pair sourced from env (`ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`), held in memory. The interface is designed so future sub-keys can plug in without touching the guard.

`apps/openbucket-backend/src/storage/key.service.ts`

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { ConfigService } from '@nestjs/config';
import { AccessKey } from '@openbucket/persistence';

export interface KeyLookupResult {
  accessKeyId: string;
  secret: string;
  disabled: boolean;
  /** True when this key is the root pair from env, not a stored sub-key. */
  isRoot: boolean;
}

@Injectable()
export class KeyService implements OnModuleInit {
  private readonly log = new Logger(KeyService.name);

  /**
   * In-memory cache keyed by accessKeyId. Holds:
   *   - the root pair (loaded at boot from env)
   *   - any sub-keys that have been looked up since.
   *
   * Sub-keys are stored *with their plaintext secret* in memory only — never
   * persisted that way. The DB holds an argon2id hash; that's only useful for
   * the admin UI to confirm key validity at creation time. SigV4 needs the
   * plaintext, which is why v1 has only the root key (loaded from env).
   *
   * Future sub-key support will require a different SigV4 storage model
   * (e.g. envelope-encrypted secrets unsealed at boot with KEK from env).
   * Out of scope for v1. The interface here is forward-compatible.
   */
  private readonly cache = new Map<string, KeyLookupResult>();

  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
    const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
    this.cache.set(rootId, {
      accessKeyId: rootId,
      secret: rootSecret,
      disabled: false,
      isRoot: true,
    });
    this.log.log(`KeyService loaded root access key (id=${redact(rootId)})`);
  }

  /**
   * Hot-path lookup for the SigV4 guard. Returns null when the key is
   * unknown OR disabled. Disabled keys are cached as `disabled: true` so a
   * disabled flood doesn't hammer SQLite.
   */
  async getSecret(accessKeyId: string): Promise<KeyLookupResult | null> {
    const cached = this.cache.get(accessKeyId);
    if (cached) {
      return cached.disabled ? null : cached;
    }

    // v1: there are no sub-keys with usable plaintext secrets. Every miss is
    // a not-found. Wired for future expansion.
    const row = await this.em.findOne(AccessKey, { accessKeyId });
    if (!row) return null;

    // Sub-key lookup path — currently unreachable. When sub-keys ship,
    // unwrap the encrypted secret here, populate cache, return.
    this.log.warn(
      `KeyService: accessKeyId=${redact(accessKeyId)} found in DB but no plaintext available — ` +
        'sub-key support not enabled in v1',
    );
    return null;
  }

  /**
   * Invalidate cache entries. Called by the admin API when a key is
   * disabled, deleted, or rotated. Root key is never invalidated this way —
   * it is bound to the boot env.
   */
  invalidate(accessKeyId: string): void {
    const cached = this.cache.get(accessKeyId);
    if (cached?.isRoot) return;
    this.cache.delete(accessKeyId);
  }

  /** Test-only and emergency-rotate hook for the root key. */
  reloadRootFromEnv(): void {
    const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
    const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
    for (const [id, entry] of this.cache) {
      if (entry.isRoot) this.cache.delete(id);
    }
    this.cache.set(rootId, {
      accessKeyId: rootId,
      secret: rootSecret,
      disabled: false,
      isRoot: true,
    });
  }
}

function redact(id: string): string {
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}
```

The S3 agent's `SigV4Guard` consumes this as:

```ts
const lookup = await this.keyService.getSecret(parsed.accessKeyId);
if (!lookup) throw new InvalidAccessKeyId();
const expected = aws4.sign({ /* canonical request */ }, { secretAccessKey: lookup.secret });
// compare expected.headers.Authorization to incoming
```

Cache invalidation on admin-side updates (disable, delete) is the admin module's responsibility — it calls `KeyService.invalidate(accessKeyId)` inside the same transaction that mutates the `access_keys` row. Because the cache is in-process and there is only one process, no distributed invalidation is needed.

---

## 3.11 Versioning storage

When a bucket has versioning `Enabled` or `Suspended`, every prior version of an object has its own row in `object_versions` and its own file on disk under a per-key version directory.

### 3.11.1 On-disk layout

```
blobs/
  <bucket>/
    photos/2026/may.jpg            # current version — directly addressable
    photos/2026/may.jpg.v/         # per-key version directory
      01J3K0...A                   # version id 1 (uuid v7, sortable by time)
      01J3K1...B                   # version id 2
      01J3K2...C                   # version id 3
```

The current pointer (`photos/2026/may.jpg`) is **always** a regular file when a current version exists. It may be the *same content* as the most recent `.v/<id>` file, or it may be conceptually distinct (e.g., during a brief window of an in-progress PUT). The relationship is mediated through SQLite — `ObjectEntity.currentVersionId` is the authoritative pointer.

Delete-markers are versions with no blob: an `ObjectVersion` row with `isDeleteMarker = true` and no corresponding file under `<key>.v/`. When the most recent version is a delete-marker, the pointer file at `blobs/<bucket>/<encoded-key>` is removed (moved to trash), and `ObjectEntity.softDeleted` is set to `true`. `GET` returns 404. `GET ?versionId=<previous>` still works because the historical version file is intact.

### 3.11.2 Promote-to-current

`apps/openbucket-backend/src/storage/version-store.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { promises as fs } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { BlobStore } from './blob-store';
import { PathResolver } from './paths';
import { ObjectEntity, ObjectVersion } from '@openbucket/persistence';

@Injectable()
export class VersionStoreService {
  private readonly paths: PathResolver;

  constructor(
    private readonly em: EntityManager,
    private readonly blobs: BlobStore,
    config: ConfigService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Promote a stored non-current version to be the bucket's current pointer.
   * Used by lifecycle ("noncurrent expiration with retention=1" — keep one
   * past version) and by admin-side restore operations.
   *
   * Sequence:
   *   1. Look up the version row.
   *   2. Verify the version blob exists on disk.
   *   3. Compose into tmp/ (which is just a cp from the version file) and
   *      atomically rename over the current pointer.
   *   4. Update ObjectEntity.currentVersionId in the same EM transaction
   *      that wraps the rename — same two-phase commit discipline as §3.7.
   */
  async promoteToCurrent(bucket: string, key: string, versionId: string): Promise<void> {
    const em = this.em.fork();
    await em.begin();
    try {
      const ver = await em.findOne(
        ObjectVersion,
        { bucket: { name: bucket }, key, versionId },
      );
      if (!ver || ver.isDeleteMarker) {
        throw new NotFoundException('version not found or is a delete marker');
      }

      const versionPath = this.paths.versionPath(bucket, key, versionId);
      // Stat to make sure the blob is there.
      await fs.stat(versionPath);

      // Compose with a single source: cheapest copy with atomic rename.
      await this.blobs.composeBlobs(
        [{ path: versionPath, size: ver.size }],
        bucket,
        key,
      );

      const row = await em.findOneOrFail(ObjectEntity, {
        bucket: { name: bucket },
        key,
      });
      row.currentVersionId = versionId;
      row.size = ver.size;
      row.etag = ver.etag;
      row.contentType = ver.contentType;
      row.userMetadata = ver.userMetadata;
      row.softDeleted = false;
      row.modifiedAt = new Date();
      em.persist(row);

      await em.commit();
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }

  /**
   * List all versions for keys with `prefix`, newest first per key.
   * Backs the S3 ListObjectVersions operation.
   */
  async listVersions(
    bucket: string,
    prefix: string,
    keyMarker: string | undefined,
    versionMarker: string | undefined,
    limit: number,
  ): Promise<ObjectVersion[]> {
    // Implemented via ObjectRepository.listVersionsByPrefix — see §3.4.2.
    // Repeated here for the interface contract; the repo is the entry point.
    return this.em.getRepository(ObjectVersion).find(
      {
        bucket: { name: bucket },
        ...(prefix ? { key: { $like: `${prefix}%` } } : {}),
        ...(keyMarker
          ? versionMarker
            ? {
                $or: [
                  { key: { $gt: keyMarker } },
                  { $and: [{ key: keyMarker }, { versionId: { $gt: versionMarker } }] },
                ],
              }
            : { key: { $gt: keyMarker } }
          : {}),
      },
      { orderBy: { key: 'ASC', createdAt: 'DESC' }, limit: limit + 1 },
    );
  }

  /**
   * Write a delete-marker version. No blob is created. The current pointer
   * file is moved to trash (so subsequent GETs return 404). The historical
   * version blobs under <key>.v/ are untouched.
   */
  async writeDeleteMarker(bucket: string, key: string): Promise<ObjectVersion> {
    const em = this.em.fork();
    await em.begin();
    try {
      const row = await em.findOne(
        ObjectEntity,
        { bucket: { name: bucket }, key },
      );
      if (!row) {
        throw new NotFoundException('object not found');
      }

      const marker = em.create(ObjectVersion, {
        bucket: row.bucket,
        key,
        versionId: cryptoUuidV7(),
        size: 0n,
        etag: '',
        contentType: '',
        userMetadata: undefined,
        isDeleteMarker: true,
        createdAt: new Date(),
      });
      em.persist(marker);

      row.currentVersionId = marker.versionId;
      row.softDeleted = true;
      row.modifiedAt = new Date();
      em.persist(row);

      await this.blobs.deleteBlob(bucket, key); // move pointer file to trash
      await em.commit();
      return marker;
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }
}

function cryptoUuidV7(): string {
  // Defer to a small util in libs/common/uuid.ts in real code; inlined here
  // so the snippet compiles standalone.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  return randomUUID();
}
```

### 3.11.3 Storing a new non-current version on write

When the bucket is versioned and a PUT lands on an existing key, the writer (§3.7.2):

1. **Demote** the existing current pointer to a stored version, by hard-linking or copying `blobs/<bucket>/<encoded-key>` to `blobs/<bucket>/<encoded-key>.v/<previousVersionId>` *before* the new blob's rename overwrites it.
2. **Rename** the new tmp file over `blobs/<bucket>/<encoded-key>`.
3. **Insert** a fresh `ObjectVersion` row for the new version and update `ObjectEntity.currentVersionId`.

Concretely, the demotion step is added between `putBlob`'s rename and the row update:

```ts
// inside ObjectWriterService.put, between the putBlob() call and em.persist(row):
if (bucket.versioning !== VersioningState.Disabled && row.currentVersionId) {
  // Demote: move the existing current pointer's bytes into the .v/ dir.
  // putBlob has already created the new pointer file at finalPath; we missed
  // the window to copy from it. So instead the writer demotes BEFORE calling
  // putBlob — corrected ordering described below.
}
```

The corrected order is:

```
1. em.begin()
2. If versioned AND current exists:
     a. Look up previous currentVersionId.
     b. Hard-link or copy blobs/<bucket>/<encoded-key> to <key>.v/<prevVersionId>
        if not already there. (No SQL — only filesystem.)
3. putBlob(tmp → final)  — atomic rename over the pointer
4. Insert new ObjectVersion row
5. Update ObjectEntity.currentVersionId
6. em.commit()
```

Step 2 is idempotent — if `<key>.v/<prevVersionId>` already exists (e.g., from a previous crash recovery), the link/copy is a no-op. Using `fs.link` first and falling back to `fs.copyFile` on `EXDEV` mirrors the rename strategy in `BlobStore.atomicRename`.

### 3.11.4 Delete semantics by versioning state

| Versioning state | DELETE behaviour |
|---|---|
| `Disabled` | Move pointer file to trash; mark `ObjectEntity.softDeleted = true`. Lifecycle purge removes the trash entry after grace. No `ObjectVersion` row written. |
| `Enabled` | Write delete-marker `ObjectVersion`; move pointer file to trash; set `softDeleted = true` and `currentVersionId = <marker>`. Historical version blobs preserved. |
| `Suspended` | Same as `Enabled` but the delete-marker version id is the literal string `"null"` (matches AWS). One delete-marker per key max in this state; subsequent deletes overwrite the `"null"` marker. |

DELETE with `?versionId=<id>`:
- If `<id>` is a delete-marker: remove the marker row; restore the most recent prior version's pointer (via `promoteToCurrent`). Pointer file rematerialised from `<key>.v/<id>`.
- If `<id>` is a real version: unlink `<key>.v/<id>` (move to trash with manifest); remove the `ObjectVersion` row. If it was the current version, promote the next-most-recent.

All of the above runs inside the same two-phase commit pattern as §3.7 — filesystem mutation first, then row update, all inside one EM transaction with rollback discipline.
