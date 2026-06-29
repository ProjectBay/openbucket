import { createHash } from 'node:crypto';
import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/** TEST-0117 — ListParts + UploadPartCopy end-to-end (STORY-0110). */
const PORT = 9239;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'parts-bucket';

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

const uploadIdOf = (xml: string) => /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1] as string;
const partNumbers = (xml: string) =>
  [...xml.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));

describe('ListParts + UploadPartCopy (e2e, STORY-0110)', () => {
  let app: SpawnedApp;
  let uploadId: string;
  const sourceData = 'COPY SOURCE PAYLOAD';

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/source.bin`, sourceData);
    const init = await signed('POST', `/${BUCKET}/target.bin?uploads`);
    uploadId = uploadIdOf(init.body);
    await signed('PUT', `/${BUCKET}/target.bin?uploadId=${uploadId}&partNumber=1`, 'first part body');
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('ListParts → ListPartsResult with the uploaded part', async () => {
    const res = await signed('GET', `/${BUCKET}/target.bin?uploadId=${uploadId}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<ListPartsResult');
    expect(res.body).toContain(`<UploadId>${uploadId}</UploadId>`);
    expect(partNumbers(res.body)).toEqual([1]);
    expect(res.body).toContain('<Size>15</Size>'); // 'first part body'
  });

  it('UploadPartCopy → CopyPartResult, then ListParts shows both parts', async () => {
    const copy = await signed(
      'PUT',
      `/${BUCKET}/target.bin?uploadId=${uploadId}&partNumber=2`,
      undefined,
      { 'x-amz-copy-source': `/${BUCKET}/source.bin` },
    );
    expect(copy.status).toBe(200);
    expect(copy.body).toContain('<CopyPartResult');
    expect(copy.body).toContain(createHash('md5').update(sourceData).digest('hex'));

    const list = await signed('GET', `/${BUCKET}/target.bin?uploadId=${uploadId}`);
    expect(partNumbers(list.body)).toEqual([1, 2]);
  });

  it('ListParts on an unknown uploadId → 404 NoSuchUpload', async () => {
    const res = await signed(
      'GET',
      `/${BUCKET}/target.bin?uploadId=00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchUpload</Code>');
  });
});
