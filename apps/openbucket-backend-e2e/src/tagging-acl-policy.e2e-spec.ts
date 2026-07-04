import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0119 (Tagging/ACL/Policy slice) — the §2.8.2/§2.8.3 sub-resource ops
 * end-to-end (STORY-0111). Bucket + object tagging round-trip, owner-full ACLs,
 * and JSON bucket-policy round-trip.
 */
const PORT = 9261;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'tag-bucket';

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

const TAGGING_XML =
  '<Tagging><TagSet><Tag><Key>env</Key><Value>prod</Value></Tag>' +
  '<Tag><Key>team</Key><Value>storage</Value></Tag></TagSet></Tagging>';

describe('Tagging / ACL / Policy (e2e, TEST-0119)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/doc.txt`, 'hello tags');
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  // -------- Bucket tagging ---------------------------------------------
  it('bucket tagging round-trips PUT → GET → DELETE → 404', async () => {
    const put = await signed('PUT', `/${BUCKET}?tagging`, TAGGING_XML);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?tagging`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Key>env</Key>');
    expect(get.body).toContain('<Value>prod</Value>');
    expect(get.body).toContain('<Key>team</Key>');

    const del = await signed('DELETE', `/${BUCKET}?tagging`);
    expect(del.status).toBe(204);

    const missing = await signed('GET', `/${BUCKET}?tagging`);
    expect(missing.status).toBe(404);
    expect(missing.body).toContain('<Code>NoSuchTagSet</Code>');
  });

  // -------- Bucket ACL -------------------------------------------------
  it('GET bucket ?acl returns the owner-full ACL; PUT is accepted', async () => {
    const get = await signed('GET', `/${BUCKET}?acl`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<AccessControlPolicy');
    expect(get.body).toContain('<Permission>FULL_CONTROL</Permission>');

    const put = await signed(
      'PUT',
      `/${BUCKET}?acl`,
      '<AccessControlPolicy><Owner><ID>openbucket-root</ID></Owner>' +
        '<AccessControlList></AccessControlList></AccessControlPolicy>',
    );
    expect(put.status).toBeLessThan(300);
  });

  // -------- Bucket policy (JSON) ---------------------------------------
  it('bucket policy round-trips PUT → GET (JSON) → DELETE → 404', async () => {
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowGet',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET}/*`,
        },
      ],
    });

    const put = await signed('PUT', `/${BUCKET}?policy`, policy);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?policy`);
    expect(get.status).toBe(200);
    expect(String(get.headers['content-type'])).toContain('application/json');
    const parsed = JSON.parse(get.body);
    expect(parsed.Version).toBe('2012-10-17');
    expect(parsed.Statement[0].Sid).toBe('AllowGet');

    const del = await signed('DELETE', `/${BUCKET}?policy`);
    expect(del.status).toBe(204);

    const missing = await signed('GET', `/${BUCKET}?policy`);
    expect(missing.status).toBe(404);
    expect(missing.body).toContain('<Code>NoSuchBucketPolicy</Code>');
  });

  it('PUT bucket ?policy with malformed JSON → 400 MalformedPolicy', async () => {
    const res = await signed('PUT', `/${BUCKET}?policy`, '{not json');
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>MalformedPolicy</Code>');
  });

  // -------- Object tagging ---------------------------------------------
  it('object tagging round-trips PUT → GET → DELETE → empty TagSet', async () => {
    const put = await signed('PUT', `/${BUCKET}/doc.txt?tagging`, TAGGING_XML);
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}/doc.txt?tagging`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Key>env</Key>');

    const del = await signed('DELETE', `/${BUCKET}/doc.txt?tagging`);
    expect(del.status).toBe(204);

    // GetObjectTagging never 404s on an empty set — returns an empty <TagSet>.
    const after = await signed('GET', `/${BUCKET}/doc.txt?tagging`);
    expect(after.status).toBe(200);
    expect(after.body).toContain('<TagSet>');
    expect(after.body).not.toContain('<Tag>');
  });

  it('object tagging on a missing key → 404 NoSuchKey', async () => {
    const res = await signed('PUT', `/${BUCKET}/missing.txt?tagging`, TAGGING_XML);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchKey</Code>');
  });

  // -------- Object ACL -------------------------------------------------
  it('GET object ?acl returns the owner-full ACL; PUT is accepted', async () => {
    const get = await signed('GET', `/${BUCKET}/doc.txt?acl`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Permission>FULL_CONTROL</Permission>');

    const put = await signed(
      'PUT',
      `/${BUCKET}/doc.txt?acl`,
      '<AccessControlPolicy><Owner><ID>openbucket-root</ID></Owner>' +
        '<AccessControlList></AccessControlList></AccessControlPolicy>',
    );
    expect(put.status).toBeLessThan(300);
  });
});
