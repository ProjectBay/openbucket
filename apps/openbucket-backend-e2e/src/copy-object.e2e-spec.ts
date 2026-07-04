import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0115 (Copy/Attributes/Restore/Torrent slice) — the remaining object-CRUD
 * ops end-to-end (STORY-0109).
 */
const PORT = 9227;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'copy-bucket';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function signed(
  method: string,
  path: string,
  body?: string,
  extra: Record<string, string> = {},
): Promise<Res> {
  // extra headers are set before signing so x-amz-* participate in the signature.
  const opts: aws4.Request = {
    host: HOST,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: { ...extra },
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

describe('CopyObject + attributes/restore/torrent (e2e, TEST-0115)', () => {
  let app: SpawnedApp;
  const SRC_BODY = 'copy me please';

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/source.txt`, SRC_BODY);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('CopyObject → 200 CopyObjectResult and the destination has the bytes', async () => {
    const res = await signed('PUT', `/${BUCKET}/dest.txt`, undefined, {
      'x-amz-copy-source': `/${BUCKET}/source.txt`,
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('<CopyObjectResult');
    expect(res.body).toContain('<ETag>');

    const get = await signed('GET', `/${BUCKET}/dest.txt`);
    expect(get.status).toBe(200);
    expect(get.body).toBe(SRC_BODY);
  });

  it('CopyObject from a missing source → 404 NoSuchKey', async () => {
    const res = await signed('PUT', `/${BUCKET}/dest2.txt`, undefined, {
      'x-amz-copy-source': `/${BUCKET}/missing.txt`,
    });
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchKey</Code>');
  });

  it('CopyObject with a non-matching copy-source-if-match → 412', async () => {
    const res = await signed('PUT', `/${BUCKET}/dest3.txt`, undefined, {
      'x-amz-copy-source': `/${BUCKET}/source.txt`,
      'x-amz-copy-source-if-match': 'deadbeef',
    });
    expect(res.status).toBe(412);
    expect(res.body).toContain('<Code>PreconditionFailed</Code>');
  });

  it('GetObjectAttributes returns the requested attributes', async () => {
    const res = await signed('GET', `/${BUCKET}/source.txt?attributes`, undefined, {
      'x-amz-object-attributes': 'ETag,ObjectSize',
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('<GetObjectAttributesOutput');
    expect(res.body).toContain('<ETag>');
    expect(res.body).toContain(`<ObjectSize>${SRC_BODY.length}</ObjectSize>`);
  });

  it('RestoreObject is a 200 no-op', async () => {
    const res = await signed('POST', `/${BUCKET}/source.txt?restore`, '<RestoreRequest></RestoreRequest>');
    expect(res.status).toBe(200);
  });

  it('GetObjectTorrent → 501 NotImplemented', async () => {
    const res = await signed('GET', `/${BUCKET}/source.txt?torrent`);
    expect(res.status).toBe(501);
    expect(res.body).toContain('<Code>NotImplemented</Code>');
  });
});
