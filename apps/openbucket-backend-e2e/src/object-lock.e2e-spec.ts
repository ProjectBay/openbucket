import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0127 (Object Lock slice) — bucket `?object-lock` configuration plus
 * per-object `?retention` and `?legal-hold` round-trips (STORY-0115). OpenBucket
 * stores the WORM metadata; enforcement on overwrite/delete is a later story.
 */
const PORT = 9269;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'ol-bucket';
const KEY = 'locked.txt';
const RETAIN_UNTIL = '2035-06-01T00:00:00.000Z';

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

const OBJECT_LOCK_XML =
  '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled>' +
  '<Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>30</Days></DefaultRetention></Rule>' +
  '</ObjectLockConfiguration>';

const RETENTION_XML =
  `<Retention><Mode>GOVERNANCE</Mode><RetainUntilDate>${RETAIN_UNTIL}</RetainUntilDate></Retention>`;

const legalHold = (status: string) => `<LegalHold><Status>${status}</Status></LegalHold>`;

describe('Object Lock (e2e, TEST-0127)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/${KEY}`, 'lock me');
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  // -------- Bucket object-lock configuration (§2.8.2) ------------------
  it('GET ?object-lock before enabling → 404 ObjectLockConfigurationNotFound', async () => {
    const res = await signed('GET', `/${BUCKET}?object-lock`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>ObjectLockConfigurationNotFoundError</Code>');
  });

  it('PUT ?object-lock → 200, GET round-trips the default retention', async () => {
    const put = await signed('PUT', `/${BUCKET}?object-lock`, OBJECT_LOCK_XML);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?object-lock`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<ObjectLockEnabled>Enabled</ObjectLockEnabled>');
    expect(get.body).toContain('<Mode>GOVERNANCE</Mode>');
    expect(get.body).toContain('<Days>30</Days>');
  });

  // -------- Object retention (§2.8.3) ---------------------------------
  it('PUT ?retention → 200, GET round-trips Mode + RetainUntilDate', async () => {
    const put = await signed('PUT', `/${BUCKET}/${KEY}?retention`, RETENTION_XML);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}/${KEY}?retention`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Retention');
    expect(get.body).toContain('<Mode>GOVERNANCE</Mode>');
    expect(get.body).toContain(`<RetainUntilDate>${RETAIN_UNTIL}</RetainUntilDate>`);
  });

  // -------- Object legal hold (§2.8.3) --------------------------------
  it('PUT ?legal-hold ON → GET ON; then OFF → GET OFF (retention preserved)', async () => {
    const on = await signed('PUT', `/${BUCKET}/${KEY}?legal-hold`, legalHold('ON'));
    expect(on.status).toBeLessThan(300);
    let get = await signed('GET', `/${BUCKET}/${KEY}?legal-hold`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Status>ON</Status>');

    const off = await signed('PUT', `/${BUCKET}/${KEY}?legal-hold`, legalHold('OFF'));
    expect(off.status).toBeLessThan(300);
    get = await signed('GET', `/${BUCKET}/${KEY}?legal-hold`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Status>OFF</Status>');

    // Setting/clearing the hold must not clobber the earlier retention.
    const ret = await signed('GET', `/${BUCKET}/${KEY}?retention`);
    expect(ret.status).toBe(200);
    expect(ret.body).toContain(`<RetainUntilDate>${RETAIN_UNTIL}</RetainUntilDate>`);
  });

  it('object-lock op on a missing key → 404 NoSuchKey', async () => {
    const res = await signed('GET', `/${BUCKET}/missing.txt?retention`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchKey</Code>');
  });
});
