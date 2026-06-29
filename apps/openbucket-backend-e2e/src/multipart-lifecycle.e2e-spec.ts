import { createHash } from 'node:crypto';
import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0309 — full multipart lifecycle end-to-end (STORY-0305/0306/0307):
 * Initiate → UploadPart×2 → Complete → GET the reassembled object, with the
 * canonical multipart ETag `md5(concat(md5ᵢ))-N`. Plus EntityTooSmall and
 * InvalidPart failure paths.
 */
const PORT = 9235;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'mpu-life';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function signed(method: string, path: string, body?: string | Buffer): Promise<Res> {
  const opts: aws4.Request = {
    host: HOST,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: {},
    body: body as string,
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

const md5hex = (s: string) => createHash('md5').update(s).digest('hex');
const uploadIdOf = (xml: string) => /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1] as string;
const completeBody = (parts: Array<{ n: number; etag: string }>) =>
  '<CompleteMultipartUpload>' +
  parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>"${p.etag}"</ETag></Part>`).join('') +
  '</CompleteMultipartUpload>';

describe('Multipart lifecycle (e2e, TEST-0309)', () => {
  let app: SpawnedApp;
  const part1 = 'a'.repeat(5 * 1024 * 1024); // 5 MiB (meets the non-last minimum)
  const part2 = 'THE FINAL PART';

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('Initiate → 2 parts → Complete → GET returns the reassembled object', async () => {
    const init = await signed('POST', `/${BUCKET}/movie.bin?uploads`);
    const uploadId = uploadIdOf(init.body);

    const up1 = await signed('PUT', `/${BUCKET}/movie.bin?uploadId=${uploadId}&partNumber=1`, part1);
    const up2 = await signed('PUT', `/${BUCKET}/movie.bin?uploadId=${uploadId}&partNumber=2`, part2);
    expect(up1.status).toBe(200);
    expect(up2.status).toBe(200);

    const etag1 = md5hex(part1);
    const etag2 = md5hex(part2);
    const composite = createHash('md5')
      .update(Buffer.concat([Buffer.from(etag1, 'hex'), Buffer.from(etag2, 'hex')]))
      .digest('hex');
    const finalEtag = `${composite}-2`;

    const done = await signed(
      'POST',
      `/${BUCKET}/movie.bin?uploadId=${uploadId}`,
      completeBody([
        { n: 1, etag: etag1 },
        { n: 2, etag: etag2 },
      ]),
    );
    expect(done.status).toBe(200);
    expect(done.body).toContain('<CompleteMultipartUploadResult');
    // The serializer XML-escapes the ETag's quotes in the body (&quot;).
    expect(done.body).toContain(`<ETag>&quot;${finalEtag}&quot;</ETag>`);
    expect(done.body).toContain(`<Location>/${BUCKET}/movie.bin</Location>`);

    const get = await signed('GET', `/${BUCKET}/movie.bin`);
    expect(get.status).toBe(200);
    expect(get.headers['content-length']).toBe(String(part1.length + part2.length));
    expect(get.body.length).toBe(part1.length + part2.length);
    expect(get.body.startsWith('aaaa')).toBe(true);
    expect(get.body.endsWith('THE FINAL PART')).toBe(true);
    expect(get.headers['etag']).toBe(`"${finalEtag}"`);

    // staging cleaned up — no longer pending
    const list = await signed('GET', `/${BUCKET}?uploads`);
    expect(list.body).not.toContain(uploadId);
  });

  it('a non-last part smaller than 5 MiB → 400 EntityTooSmall', async () => {
    const init = await signed('POST', `/${BUCKET}/small.bin?uploads`);
    const uploadId = uploadIdOf(init.body);
    const a = 'tiny first part';
    const b = 'second';
    await signed('PUT', `/${BUCKET}/small.bin?uploadId=${uploadId}&partNumber=1`, a);
    await signed('PUT', `/${BUCKET}/small.bin?uploadId=${uploadId}&partNumber=2`, b);
    const done = await signed(
      'POST',
      `/${BUCKET}/small.bin?uploadId=${uploadId}`,
      completeBody([
        { n: 1, etag: md5hex(a) },
        { n: 2, etag: md5hex(b) },
      ]),
    );
    expect(done.status).toBe(400);
    expect(done.body).toContain('<Code>EntityTooSmall</Code>');
  });

  it('a declared ETag that does not match the recorded part → 400 InvalidPart', async () => {
    const init = await signed('POST', `/${BUCKET}/bad.bin?uploads`);
    const uploadId = uploadIdOf(init.body);
    await signed('PUT', `/${BUCKET}/bad.bin?uploadId=${uploadId}&partNumber=1`, 'only part');
    const done = await signed(
      'POST',
      `/${BUCKET}/bad.bin?uploadId=${uploadId}`,
      completeBody([{ n: 1, etag: 'deadbeefdeadbeefdeadbeefdeadbeef' }]),
    );
    expect(done.status).toBe(400);
    expect(done.body).toContain('<Code>InvalidPart</Code>');
  });
});
