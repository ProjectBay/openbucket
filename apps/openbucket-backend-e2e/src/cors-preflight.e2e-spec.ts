import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0132 (CORS preflight) — OPTIONS /:bucket/:key against a running app
 * (STORY-0117). Confirms CorsController is mounted before ObjectController, that
 * OPTIONS bypasses SigV4 (the preflight requests carry no Authorization), and
 * that the headers are synthesised from the bucket's stored CORS rules.
 */
const PORT = 9273;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'cors-pf-bucket';
const NO_CORS_BUCKET = 'cors-pf-none';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Signed request (aws4) — used only for setup (create bucket, PUT ?cors). */
function signed(method: string, path: string, body?: string): Promise<Res> {
  const opts: aws4.Request = { host: HOST, method, path, service: 's3', region: 'us-east-1', headers: {}, body };
  aws4.sign(opts, CREDS);
  return send(method, path, opts.headers as Record<string, string>, body);
}

/** Raw, UNSIGNED request — preflights are never signed (the SigV4 bypass). */
function options(path: string, headers: Record<string, string>): Promise<Res> {
  return send('OPTIONS', path, headers);
}

function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: PORT, method, path, headers, agent: false },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const CORS_XML =
  '<CORSConfiguration><CORSRule>' +
  '<AllowedOrigin>https://example.com</AllowedOrigin>' +
  '<AllowedMethod>GET</AllowedMethod>' +
  '<AllowedHeader>*</AllowedHeader>' +
  '<ExposeHeader>ETag</ExposeHeader>' +
  '<MaxAgeSeconds>3000</MaxAgeSeconds>' +
  '</CORSRule></CORSConfiguration>';

describe('CORS preflight (e2e, TEST-0132)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}?cors`, CORS_XML);
    await signed('PUT', `/${NO_CORS_BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: allowed origin+method, unsigned → 200 with CORS headers', async () => {
    const res = await options(`/${BUCKET}/some/key.txt`, {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-custom',
    });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
    expect(res.headers['access-control-allow-methods']).toBe('GET');
    expect(res.headers['access-control-allow-headers']).toBe('*');
    expect(res.headers['access-control-expose-headers']).toBe('ETag');
    expect(res.headers['access-control-max-age']).toBe('3000');
    expect(String(res.headers['vary'])).toContain('Origin');
  });

  it('case 2: non-allowed origin → 403 AccessDenied', async () => {
    const res = await options(`/${BUCKET}/some/key.txt`, {
      Origin: 'https://evil.com',
      'Access-Control-Request-Method': 'GET',
    });
    expect(res.status).toBe(403);
    expect(res.body).toContain('<Code>AccessDenied</Code>');
    expect(res.body).toContain('CORSResponse: This CORS request is not allowed.');
  });

  it('case 3: bucket without CORS config → 404 NoSuchCORSConfiguration', async () => {
    const res = await options(`/${NO_CORS_BUCKET}/some/key.txt`, {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'GET',
    });
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchCORSConfiguration</Code>');
  });

  it('case 4: no Origin → 200, Allow header, no CORS headers', async () => {
    const res = await options(`/${BUCKET}/some/key.txt`, {});
    expect(res.status).toBe(200);
    expect(res.headers['allow']).toBe('GET, HEAD, PUT, POST, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
