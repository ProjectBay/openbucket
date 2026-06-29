import * as aws4 from 'aws4';

import { SpawnedApp, httpGet, spawnApp } from './support/spawn-app';

/**
 * TEST-0111 — ListBuckets service-scope operation, end-to-end.
 *
 * Exercises the whole M2 read stack against the built app: the SigV4 guard +
 * verifier, the ServiceController, the domain BucketService's request-scoped
 * DB read, and the XmlInterceptor/serializer envelope.
 */
describe('ListBuckets (e2e, TEST-0111)', () => {
  let app: SpawnedApp;
  const port = 9217;
  const host = `127.0.0.1:${port}`;

  beforeAll(async () => {
    app = await spawnApp(port);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('rejects an unauthenticated GET / with 403 AccessDenied', async () => {
    const res = await httpGet(`${app.baseUrl}/`);
    expect(res.status).toBe(403);
    expect(res.body).toContain('<Code>AccessDenied</Code>');
  });

  it('returns 200 <ListAllMyBucketsResult> for a valid SigV4 signature', async () => {
    const opts: aws4.Request = {
      host,
      method: 'GET',
      path: '/',
      service: 's3',
      region: 'us-east-1',
      headers: {},
    };
    aws4.sign(opts, {
      accessKeyId: 'AKIA1234567890ABCD',
      secretAccessKey: 'x'.repeat(40),
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k] = String(v);

    const res = await httpGet(`${app.baseUrl}/`, headers);

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('application/xml');
    expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res.body).toContain(
      '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    );
    expect(res.body).toContain('<Owner><ID>openbucket-root</ID><DisplayName>openbucket</DisplayName></Owner>');
  });
});
