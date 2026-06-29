import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0121 (CORS configuration slice) — GET/PUT/DELETE /:bucket?cors round-trip
 * a `<CORSConfiguration>` document (STORY-0112). The stored rules drive the
 * preflight handler in STORY-0117.
 */
const PORT = 9263;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'cors-bucket';

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

const CORS_XML =
  '<CORSConfiguration><CORSRule>' +
  '<ID>r1</ID>' +
  '<AllowedOrigin>https://example.com</AllowedOrigin>' +
  '<AllowedOrigin>https://app.example.com</AllowedOrigin>' +
  '<AllowedMethod>GET</AllowedMethod>' +
  '<AllowedMethod>PUT</AllowedMethod>' +
  '<AllowedHeader>*</AllowedHeader>' +
  '<ExposeHeader>ETag</ExposeHeader>' +
  '<MaxAgeSeconds>3000</MaxAgeSeconds>' +
  '</CORSRule></CORSConfiguration>';

describe('Bucket CORS configuration (e2e, TEST-0121)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('GET ?cors with no config → 404 NoSuchCORSConfiguration', async () => {
    const res = await signed('GET', `/${BUCKET}?cors`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchCORSConfiguration</Code>');
  });

  it('PUT → GET round-trips the rules', async () => {
    const put = await signed('PUT', `/${BUCKET}?cors`, CORS_XML);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?cors`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<CORSConfiguration');
    expect(get.body).toContain('<AllowedOrigin>https://example.com</AllowedOrigin>');
    expect(get.body).toContain('<AllowedOrigin>https://app.example.com</AllowedOrigin>');
    expect(get.body).toContain('<AllowedMethod>GET</AllowedMethod>');
    expect(get.body).toContain('<AllowedMethod>PUT</AllowedMethod>');
    expect(get.body).toContain('<AllowedHeader>*</AllowedHeader>');
    expect(get.body).toContain('<ExposeHeader>ETag</ExposeHeader>');
    expect(get.body).toContain('<MaxAgeSeconds>3000</MaxAgeSeconds>');
    expect(get.body).toContain('<ID>r1</ID>');
  });

  it('DELETE clears the config → 204, then GET → 404', async () => {
    const del = await signed('DELETE', `/${BUCKET}?cors`);
    expect(del.status).toBe(204);

    const get = await signed('GET', `/${BUCKET}?cors`);
    expect(get.status).toBe(404);
    expect(get.body).toContain('<Code>NoSuchCORSConfiguration</Code>');
  });

  it('GET ?cors on a missing bucket → 404 NoSuchBucket', async () => {
    const res = await signed('GET', `/no-such-cors-bucket?cors`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchBucket</Code>');
  });
});
