import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0308/0309 (Initiate slice) — InitiateMultipartUpload end-to-end
 * (STORY-0305).
 */
const PORT = 9231;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'mpu-bucket';

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

describe('InitiateMultipartUpload (e2e, STORY-0305)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('POST ?uploads → 200 InitiateMultipartUploadResult with a UUID UploadId', async () => {
    const res = await signed('POST', `/${BUCKET}/big.bin?uploads`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(
      '<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    );
    expect(res.body).toContain(`<Bucket>${BUCKET}</Bucket>`);
    expect(res.body).toContain('<Key>big.bin</Key>');
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(res.body)?.[1];
    expect(uploadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('the pending upload is visible via ListMultipartUploads', async () => {
    await signed('POST', `/${BUCKET}/another.bin?uploads`);
    const res = await signed('GET', `/${BUCKET}?uploads`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<ListMultipartUploadsResult');
    expect(res.body).toContain('<Key>another.bin</Key>');
    expect(res.body).toContain('<UploadId>');
  });

  it('Initiate on a missing bucket → 404 NoSuchBucket', async () => {
    const res = await signed('POST', '/no-bucket/k?uploads');
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchBucket</Code>');
  });
});
