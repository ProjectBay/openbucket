import { randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import { MikroORM, EntityManager } from '@mikro-orm/better-sqlite';
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
} from '../../persistence/index';

import type { AppConfigService } from '../config/app-config.service';
import type { Clock } from '../clock/clock';
import { BlobStore } from '../../storage/blob-store';
import { Migration20260520000001_initial } from '../../migrations/Migration20260520000001_initial';
import { MultipartCleanupRunner } from './multipart-cleanup.runner';

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
const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;
const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

/** TEST-0321 — MultipartCleanupRunner with a fixed Clock. */
describe('MultipartCleanupRunner (TEST-0321)', () => {
  let orm: MikroORM;
  let dataDir: string;
  let blobs: BlobStore;
  let runner: MultipartCleanupRunner;

  beforeAll(async () => {
    dataDir = join(process.cwd(), 'tmp', `ob-mpc-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: ENTITIES,
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
        afterCreate: (conn: { pragma: (s: string) => void }, done: () => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.getMigrator().up();

    const seed = orm.em.fork();
    const bucket = seed.create(Bucket, { name: 'b' });
    // Old: initiated 48h ago (expired under a 24h TTL). Fresh: 1h ago.
    seed.create(MultipartUpload, {
      uploadId: 'old-upload',
      bucket,
      key: 'big.bin',
      initiatedAt: new Date(NOW - 48 * HOUR),
    });
    seed.create(MultipartUpload, {
      uploadId: 'fresh-upload',
      bucket,
      key: 'recent.bin',
      initiatedAt: new Date(NOW - 1 * HOUR),
    });
    await seed.flush();

    blobs = new BlobStore(stubConfig(dataDir));
    await fs.mkdir(blobs.paths.multipartDir('old-upload'), { recursive: true });
    await fs.writeFile(blobs.paths.multipartPartPath('old-upload', 1), 'staged part');
    await fs.mkdir(blobs.paths.multipartDir('fresh-upload'), { recursive: true });

    const config = { multipartTtlHours: 24 } as AppConfigService;
    const clock = { nowMs: () => NOW } as unknown as Clock;
    runner = new MultipartCleanupRunner(orm.em as EntityManager, blobs, config, clock);
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('reaps sessions older than the TTL (row + staging dir) and leaves fresh ones', async () => {
    await runner.run();

    const em = orm.em.fork();
    expect(await em.findOne(MultipartUpload, { uploadId: 'old-upload' })).toBeNull();
    expect(await em.findOne(MultipartUpload, { uploadId: 'fresh-upload' })).not.toBeNull();

    expect(existsSync(blobs.paths.multipartDir('old-upload'))).toBe(false);
    expect(existsSync(blobs.paths.multipartDir('fresh-upload'))).toBe(true);
  });
});
