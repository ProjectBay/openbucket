import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/** TEST-0309 (Abort slice) — AbortMultipartUpload end-to-end (STORY-0308). */
const PORT = 9237;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'abort-bucket';

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

describe('AbortMultipartUpload (e2e, STORY-0308)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('Abort → 204 and the session disappears from ListMultipartUploads', async () => {
    const init = await signed('POST', `/${BUCKET}/scrap.bin?uploads`);
    const uploadId = uploadIdOf(init.body);
    await signed('PUT', `/${BUCKET}/scrap.bin?uploadId=${uploadId}&partNumber=1`, 'discard me');

    const before = await signed('GET', `/${BUCKET}?uploads`);
    expect(before.body).toContain(uploadId);

    const abort = await signed('DELETE', `/${BUCKET}/scrap.bin?uploadId=${uploadId}`);
    expect(abort.status).toBe(204);

    const after = await signed('GET', `/${BUCKET}?uploads`);
    expect(after.body).not.toContain(uploadId);
  });

  it('Abort on an unknown uploadId → 404 NoSuchUpload', async () => {
    const res = await signed(
      'DELETE',
      `/${BUCKET}/scrap.bin?uploadId=00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchUpload</Code>');
  });
});
