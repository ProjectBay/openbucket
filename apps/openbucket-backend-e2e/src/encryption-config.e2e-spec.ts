import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0129 (Encryption configuration slice) — GET/PUT/DELETE /:bucket?encryption
 * round-trip a `<ServerSideEncryptionConfiguration>` (STORY-0116). v1 supports
 * SSE-S3 (AES256) only; aws:kms is rejected with InvalidArgument.
 */
const PORT = 9271;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'enc-bucket';

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

const sseConfig = (algorithm: string) =>
  '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault>' +
  `<SSEAlgorithm>${algorithm}</SSEAlgorithm>` +
  '</ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>';

describe('Bucket encryption configuration (e2e, TEST-0129)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('GET ?encryption with no config → 404', async () => {
    const res = await signed('GET', `/${BUCKET}?encryption`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>ServerSideEncryptionConfigurationNotFoundError</Code>');
  });

  it('PUT AES256 → 200, GET round-trips the document', async () => {
    const put = await signed('PUT', `/${BUCKET}?encryption`, sseConfig('AES256'));
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?encryption`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<ServerSideEncryptionConfiguration');
    expect(get.body).toContain('<SSEAlgorithm>AES256</SSEAlgorithm>');
  });

  it('DELETE clears the config → 204, then GET → 404', async () => {
    const del = await signed('DELETE', `/${BUCKET}?encryption`);
    expect(del.status).toBe(204);

    const get = await signed('GET', `/${BUCKET}?encryption`);
    expect(get.status).toBe(404);
  });

  it('PUT aws:kms → 400 InvalidArgument (SSE-KMS unsupported in v1)', async () => {
    const res = await signed('PUT', `/${BUCKET}?encryption`, sseConfig('aws:kms'));
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>InvalidArgument</Code>');
  });

  it('GET ?encryption on a missing bucket → 404 NoSuchBucket', async () => {
    const res = await signed('GET', `/no-such-enc-bucket?encryption`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchBucket</Code>');
  });
});
