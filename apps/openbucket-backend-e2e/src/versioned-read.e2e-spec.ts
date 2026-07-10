import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0311 — Versioned reads (GET/HEAD ?versionId, §3.11) end-to-end.
 *
 * Drives the real wire path against the built app: enable versioning, PUT the
 * same key three times (distinct bytes + distinct user-metadata), list the
 * versions, then fetch each specific version back by `?versionId` and assert it
 * returns the right bytes, ETag, `x-amz-version-id`, and `x-amz-meta-*`. Also
 * pins: current read (no versionId) → newest; unknown versionId → 404
 * NoSuchVersion; and that a plain GET/HEAD now emits `x-amz-meta-*`.
 */
const PORT = 9277;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'versioned-read-bucket';
const KEY = 'doc.txt';

const V1 = 'version-one-payload';
const V2 = 'version-two-payload-longer';
const V3 = 'v3';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function signed(
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  const opts: aws4.Request = {
    host: HOST,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: { ...extraHeaders },
    body,
  };
  aws4.sign(opts, CREDS);
  return new Promise((resolve, reject) => {
    // agent:false — a fresh socket per request, as the streamed GET path needs.
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

const hdr = (r: Res, name: string): string | undefined => {
  const v = r.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

describe('Versioned reads GET/HEAD ?versionId (e2e, TEST-0311)', () => {
  let app: SpawnedApp;
  // Version ids as reported by each PUT's x-amz-version-id, newest last.
  const ids: string[] = [];

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed(
      'PUT',
      `/${BUCKET}?versioning`,
      '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',
    );

    for (const [body, tag] of [
      [V1, 'one'],
      [V2, 'two'],
      [V3, 'three'],
    ] as const) {
      const put = await signed('PUT', `/${BUCKET}/${KEY}`, body, {
        'content-type': 'text/plain',
        'x-amz-meta-rev': tag,
      });
      expect(put.status).toBe(200);
      const vid = hdr(put, 'x-amz-version-id');
      expect(typeof vid).toBe('string');
      ids.push(vid as string);
    }
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('PUT returned three distinct version ids', () => {
    expect(new Set(ids).size).toBe(3);
  });

  it('ListObjectVersions reports all three versions with those ids', async () => {
    const res = await signed('GET', `/${BUCKET}?versions`);
    expect(res.status).toBe(200);
    for (const id of ids) expect(res.body).toContain(`<VersionId>${id}</VersionId>`);
    // Newest first: the current version is flagged IsLatest=true.
    expect(res.body).toContain('<IsLatest>true</IsLatest>');
  });

  it('GET ?versionId returns each specific version bytes + x-amz-version-id + x-amz-meta', async () => {
    const cases: Array<[string, string, string]> = [
      [ids[0], V1, 'one'],
      [ids[1], V2, 'two'],
      [ids[2], V3, 'three'],
    ];
    for (const [id, body, tag] of cases) {
      const res = await signed('GET', `/${BUCKET}/${KEY}?versionId=${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toBe(body);
      expect(hdr(res, 'x-amz-version-id')).toBe(id);
      expect(hdr(res, 'content-length')).toBe(String(body.length));
      expect(hdr(res, 'x-amz-meta-rev')).toBe(tag);
    }
  });

  it('HEAD ?versionId returns the version metadata (no body) incl. x-amz-meta', async () => {
    const res = await signed('HEAD', `/${BUCKET}/${KEY}?versionId=${ids[0]}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
    expect(hdr(res, 'content-length')).toBe(String(V1.length));
    expect(hdr(res, 'x-amz-version-id')).toBe(ids[0]);
    expect(hdr(res, 'x-amz-meta-rev')).toBe('one');
  });

  it('GET ?versionId supports Range on a historical version', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}?versionId=${ids[0]}`, undefined, {
      range: 'bytes=0-6',
    });
    expect(res.status).toBe(206);
    expect(res.body).toBe(V1.slice(0, 7));
    expect(hdr(res, 'x-amz-version-id')).toBe(ids[0]);
  });

  it('GET without versionId returns the CURRENT (newest) version', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe(V3);
    expect(hdr(res, 'x-amz-version-id')).toBe(ids[2]);
    // Current-version GET must also carry user-metadata (S3 parity).
    expect(hdr(res, 'x-amz-meta-rev')).toBe('three');
  });

  it('HEAD without versionId emits x-amz-meta on the current version', async () => {
    const res = await signed('HEAD', `/${BUCKET}/${KEY}`);
    expect(res.status).toBe(200);
    expect(hdr(res, 'x-amz-meta-rev')).toBe('three');
    expect(hdr(res, 'x-amz-version-id')).toBe(ids[2]);
  });

  it('GET ?versionId with an unknown version → 404 NoSuchVersion', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}?versionId=00000000-0000-7000-8000-000000000000`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchVersion</Code>');
  });

  it('HEAD ?versionId with an unknown version → 404 (body-less)', async () => {
    const res = await signed('HEAD', `/${BUCKET}/${KEY}?versionId=00000000-0000-7000-8000-000000000000`);
    expect(res.status).toBe(404);
  });
});
