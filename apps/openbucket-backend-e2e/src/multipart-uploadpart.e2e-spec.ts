import { createHash } from 'node:crypto';
import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0311 (UploadPart slice) — UploadPart streaming + per-part ETag
 * (STORY-0306), end-to-end.
 */
const PORT = 9233;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'part-bucket';

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

const uploadIdOf = (xml: string) => /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1] as string;

describe('UploadPart (e2e, STORY-0306)', () => {
  let app: SpawnedApp;
  let uploadId: string;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    const init = await signed('POST', `/${BUCKET}/multi.bin?uploads`);
    uploadId = uploadIdOf(init.body);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('UploadPart → 200 with the part MD5 as the ETag', async () => {
    const body = 'PART ONE DATA';
    const md5 = createHash('md5').update(body).digest('hex');
    const res = await signed(
      'PUT',
      `/${BUCKET}/multi.bin?uploadId=${uploadId}&partNumber=1`,
      body,
    );
    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBe(`"${md5}"`);
  });

  it('partNumber outside [1,10000] → 400 InvalidArgument', async () => {
    const res = await signed(
      'PUT',
      `/${BUCKET}/multi.bin?uploadId=${uploadId}&partNumber=10001`,
      'x',
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>InvalidArgument</Code>');
  });

  it('unknown uploadId → 404 NoSuchUpload', async () => {
    const res = await signed(
      'PUT',
      `/${BUCKET}/multi.bin?uploadId=00000000-0000-0000-0000-000000000000&partNumber=1`,
      'x',
    );
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchUpload</Code>');
  });
});
