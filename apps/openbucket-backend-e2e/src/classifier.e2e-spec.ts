import { SpawnedApp, httpGet, spawnApp } from './support/spawn-app';

/**
 * TEST-0008 — classifier behaviour observable over HTTP.
 *
 * The classifier's `kind` decision is observable via which subsystem answers:
 * admin routes return JSON, S3-classified routes return the S3 XML error
 * shape, and every response carries x-amz-request-id (set by request-id mw).
 */
describe('request classifier (e2e)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(9211, { OPENBUCKET_ENDPOINT: 's3.example.com' });
  });

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('admin path → JSON (kind=admin)', async () => {
    const res = await fetch(`${app.baseUrl}/api/admin/health`);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('x-amz-request-id')).toBe(res.headers.get('x-request-id'));
  });

  it('root path → S3 XML error (kind=s3, path-style)', async () => {
    // `GET /` is the ListBuckets route (STORY-0107) and is SigV4-guarded, so an
    // unauthenticated request is rejected with 403 AccessDenied as S3 XML.
    const res = await fetch(`${app.baseUrl}/`);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<Code>AccessDenied</Code>');
  });

  it('bucket/key path → S3 XML with Resource reflecting the path', async () => {
    const res = await fetch(`${app.baseUrl}/mybucket/some/key.txt`);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    // path-style: first segment is the bucket, remainder the key
    expect(xml).toContain('<Resource>/mybucket/some/key.txt</Resource>');
  });

  it('virtual-host style → bucket resolved from Host header', async () => {
    // Raw http: fetch/undici refuses to set a custom Host header.
    const res = await httpGet(`${app.baseUrl}/object.bin`, {
      Host: 'mybucket.s3.example.com',
    });
    expect(String(res.headers['content-type'])).toContain('application/xml');
    expect(res.body).toContain('<Resource>/mybucket/object.bin</Resource>');
  });
});
