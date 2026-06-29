import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { SpaController } from './spa.controller';
import { rewriteBaseHref, safeAssetPath, SPA_ROOT } from './spa-utils';

describe('spa-utils', () => {
  it('rewriteBaseHref points <base> at <mountPath>/admin/', () => {
    expect(rewriteBaseHref('<base href="/admin/">', '/storage')).toContain('href="/storage/admin/"');
    expect(rewriteBaseHref('<base href="/admin/">', '')).toContain('href="/admin/"');
  });

  it('safeAssetPath rejects traversal outside the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ob-spa-trav-'));
    writeFileSync(join(root, 'app.js'), '1');
    expect(safeAssetPath(root, 'app.js')).not.toBeNull();
    expect(safeAssetPath(root, '../../etc/passwd')).toBeNull();
    expect(safeAssetPath(root, 'missing.js')).toBeNull();
  });
});

describe('SpaController (fixture SPA, mountPath "")', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'ob-spa-'));
    writeFileSync(
      join(root, 'index.html'),
      '<html><head><base href="/admin/"></head><body>OPENBUCKET_SHELL</body></html>',
    );
    // Realistic Angular v21 hashed-asset name (dash separator, uppercase-alnum
    // hash) — the form the old lowercase-hex/dot-only regex failed to match.
    writeFileSync(join(root, 'main-UZ7C7DZ3.js'), 'console.log("ob")');
    // Legacy `name.HASH.ext` form, kept to guard backward compatibility.
    writeFileSync(join(root, 'polyfills.0a1b2c3d.js'), 'console.log("poly")');

    const ref = await Test.createTestingModule({
      controllers: [SpaController],
      providers: [{ provide: SPA_ROOT, useValue: root }],
    }).compile();
    app = ref.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the shell at /admin', async () => {
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('OPENBUCKET_SHELL');
    expect(res.text).toContain('<base href="/admin/">');
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('serves a hashed asset (Angular `name-HASH.ext`) with an immutable cache', async () => {
    const res = await request(app.getHttpServer()).get('/admin/main-UZ7C7DZ3.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('also treats the legacy `name.HASH.ext` form as immutable', async () => {
    const res = await request(app.getHttpServer()).get('/admin/polyfills.0a1b2c3d.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('falls back to the shell for client-side routes', async () => {
    const res = await request(app.getHttpServer()).get('/admin/buckets/my-bucket');
    expect(res.status).toBe(200);
    expect(res.text).toContain('OPENBUCKET_SHELL');
  });
});

describe('SpaController (UI not bundled → 404)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [SpaController],
      providers: [{ provide: SPA_ROOT, useValue: null }],
    }).compile();
    app = ref.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 404 when no SPA is bundled', async () => {
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.status).toBe(404);
  });
});
