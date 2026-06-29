import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0125 (Lifecycle configuration slice) — GET/PUT/DELETE /:bucket?lifecycle
 * round-trip a `<LifecycleConfiguration>` document (STORY-0114). OpenBucket has a
 * single storage tier, so `<Transition>` elements are accepted and ignored; only
 * the expiration-style rules the background sweep understands round-trip.
 */
const PORT = 9267;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'lc-bucket';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function signed(method: string, path: string, body?: string): Promise<Res> {
  const opts: aws4.Request = {
    host: HOST,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: {},
    body,
  };
  aws4.sign(opts, CREDS);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: PORT, method, path, headers: opts.headers, agent: false },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const ONE_RULE =
  '<LifecycleConfiguration><Rule>' +
  '<ID>r1</ID><Status>Enabled</Status>' +
  '<Expiration><Days>30</Days></Expiration>' +
  '</Rule></LifecycleConfiguration>';

// Two rules; the second carries a storage-class <Transition> that must be ignored.
const TWO_RULES =
  '<LifecycleConfiguration>' +
  '<Rule><ID>r1</ID><Status>Enabled</Status>' +
  '<Expiration><Days>30</Days></Expiration></Rule>' +
  '<Rule><ID>r2</ID><Status>Disabled</Status>' +
  '<Filter><Prefix>logs/</Prefix></Filter>' +
  '<Transition><Days>10</Days><StorageClass>GLACIER</StorageClass></Transition>' +
  '<Expiration><Days>90</Days></Expiration></Rule>' +
  '</LifecycleConfiguration>';

describe('Bucket lifecycle configuration (e2e, TEST-0125)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('GET ?lifecycle with no config → 404 NoSuchLifecycleConfiguration', async () => {
    const res = await signed('GET', `/${BUCKET}?lifecycle`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchLifecycleConfiguration</Code>');
  });

  it('PUT one rule → 200, GET round-trips it (single Rule still an element)', async () => {
    const put = await signed('PUT', `/${BUCKET}?lifecycle`, ONE_RULE);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?lifecycle`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<LifecycleConfiguration');
    expect(get.body).toContain('<Rule>');
    expect(get.body).toContain('<ID>r1</ID>');
    expect(get.body).toContain('<Status>Enabled</Status>');
    expect(get.body).toContain('<Days>30</Days>');
  });

  it('PUT two rules with a <Transition> → 200; GET returns both, Transition ignored', async () => {
    const put = await signed('PUT', `/${BUCKET}?lifecycle`, TWO_RULES);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?lifecycle`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<ID>r1</ID>');
    expect(get.body).toContain('<ID>r2</ID>');
    expect(get.body).toContain('<Status>Disabled</Status>');
    expect(get.body).toContain('<Prefix>logs/</Prefix>');
    expect(get.body).toContain('<Days>90</Days>');
    // The single storage tier means transitions are dropped on the way through.
    expect(get.body).not.toContain('<Transition>');
    expect(get.body).not.toContain('GLACIER');
  });

  it('DELETE clears the config → 204, then GET → 404', async () => {
    const del = await signed('DELETE', `/${BUCKET}?lifecycle`);
    expect(del.status).toBe(204);

    const get = await signed('GET', `/${BUCKET}?lifecycle`);
    expect(get.status).toBe(404);
    expect(get.body).toContain('<Code>NoSuchLifecycleConfiguration</Code>');
  });

  it('GET ?lifecycle on a missing bucket → 404 NoSuchBucket', async () => {
    const res = await signed('GET', `/no-such-lc-bucket?lifecycle`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchBucket</Code>');
  });
});
