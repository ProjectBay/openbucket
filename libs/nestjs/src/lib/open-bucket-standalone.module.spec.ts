import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { normalizeMount } from './common/config/env.schema';
import { buildConfig } from './common/config/config-source';
import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from './open-bucket-options';
import { OpenBucketStandaloneModule } from './open-bucket-standalone.module';

/**
 * Standalone `MOUNT_PATH` support. `OpenBucketStandaloneModule.forRoot('/storage')`
 * mounts the whole tree under the prefix by reusing the library's RouterModule
 * machinery and provides a mount-only `OPEN_BUCKET_OPTIONS` token, so the
 * admin-guard, classifier, and S3/SigV4 flow all become mount-aware WITHOUT any
 * per-consumer wiring. Boots the real core graph (env-driven, like the standalone
 * app) and drives it over HTTP.
 */
describe('normalizeMount (MOUNT_PATH normalization)', () => {
  it.each([
    ['', ''],
    ['/', ''],
    ['storage', '/storage'],
    ['/storage', '/storage'],
    ['/storage/', '/storage'],
    ['  /storage  ', '/storage'],
    ['/a/b/', '/a/b'],
  ])('normalizes %p → %p', (input, expected) => {
    expect(normalizeMount(input)).toBe(expected);
  });
});

describe('buildConfig dual-mode marker (mount-only options → env)', () => {
  it('treats a mount-only OPEN_BUCKET_OPTIONS (no rootCredentials) as standalone/env', () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATA_DIR: '/d',
      MOUNT_PATH: '/storage',
      JWT_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      ROOT_ACCESS_KEY_ID: 'AKIA0000000000000000',
      ROOT_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    });
    try {
      // The mount-only marker must NOT be mapped as library config — it lacks
      // rootCredentials, so config comes from process.env (which carries MOUNT_PATH).
      const cfg = buildConfig({ mountPath: '/storage' } as ResolvedOpenBucketOptions);
      expect(cfg.DATA_DIR).toBe('/d');
      expect(cfg.MOUNT_PATH).toBe('/storage');
    } finally {
      process.env = saved;
    }
  });
});

describe('OpenBucketStandaloneModule.forRoot — server under a MOUNT_PATH', () => {
  let app: INestApplication;
  let dataDir: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ob-mount-'));
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      MOUNT_PATH: '/storage',
      JWT_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      ROOT_ACCESS_KEY_ID: 'AKIA1234567890ABCD',
      ROOT_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [OpenBucketStandaloneModule.forRoot('/storage')],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = savedEnv;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('provides a mount-aware OPEN_BUCKET_OPTIONS token', () => {
    const opts = app.get<ResolvedOpenBucketOptions>(OPEN_BUCKET_OPTIONS);
    expect(opts.mountPath).toBe('/storage');
  });

  it('serves the public health probe under the mount', async () => {
    const res = await request(app.getHttpServer()).get('/storage/api/admin/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('guards the admin API under the mount — unauthenticated → 401', async () => {
    const res = await request(app.getHttpServer()).get('/storage/api/admin/buckets');
    expect(res.status).toBe(401);
  });

  it('does not mount the admin API at the ROOT (no prefix) — 404', async () => {
    // The route only exists under `/storage`; a root hit matches no controller.
    const res = await request(app.getHttpServer()).get('/api/admin/buckets');
    expect(res.status).toBe(404);
  });

  it('classifies a path-style request under the mount as S3 (XML error, not admin/404)', async () => {
    // Unsigned S3 request under the prefix → SigV4 rejects with the S3 XML shape,
    // and the classifier stripped `/storage` so the bucket is `some-bucket` (NOT
    // `storage`): the Resource is `/some-bucket/key.txt`, proving mount-aware S3.
    const res = await request(app.getHttpServer()).get('/storage/some-bucket/key.txt');
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<Resource>/some-bucket/key.txt</Resource>');
  });
});
