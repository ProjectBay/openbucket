import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0135 — ListObjectsV2 pagination with HMAC-sealed continuation tokens
 * (STORY-0118), end-to-end against the built app.
 */
const PORT = 9229;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'page-bucket';
const KEYS = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'];

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

const keysIn = (xml: string): string[] =>
  [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
const nextToken = (xml: string): string | undefined =>
  /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];

describe('ListObjectsV2 (e2e, TEST-0135)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    for (const k of KEYS) await signed('PUT', `/${BUCKET}/${k}`, k);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('paginates the full keyspace via continuation tokens', async () => {
    const collected: string[] = [];
    let token: string | undefined;
    let pages = 0;

    do {
      const qs = `list-type=2&max-keys=2${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
      const res = await signed('GET', `/${BUCKET}?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('<ListBucketResult');
      collected.push(...keysIn(res.body));
      token = nextToken(res.body);
      pages++;
      expect(pages).toBeLessThan(10); // guard against a runaway loop
    } while (token);

    expect(collected).toEqual(KEYS); // every key, in order, exactly once
    expect(pages).toBe(3); // 2 + 2 + 1
  });

  it('first page is truncated with a token; KeyCount reflects the page', async () => {
    const res = await signed('GET', `/${BUCKET}?list-type=2&max-keys=2`);
    expect(res.body).toContain('<IsTruncated>true</IsTruncated>');
    expect(res.body).toContain('<KeyCount>2</KeyCount>');
    expect(nextToken(res.body)).toBeTruthy();
  });

  it('a forged continuation token is rejected with InvalidArgument', async () => {
    const res = await signed('GET', `/${BUCKET}?list-type=2&continuation-token=Zm9yZ2Vktoken`);
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>InvalidArgument</Code>');
  });

  it('a valid token from another bucket is rejected', async () => {
    const first = await signed('GET', `/${BUCKET}?list-type=2&max-keys=2`);
    const token = nextToken(first.body)!;
    await signed('PUT', `/${BUCKET}-other`);
    const res = await signed(
      'GET',
      `/${BUCKET}-other?list-type=2&continuation-token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>InvalidArgument</Code>');
  });
});
