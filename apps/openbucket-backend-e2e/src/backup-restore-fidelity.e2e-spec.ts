import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as argon2 from 'argon2';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * Backup → FRESH-INSTANCE restore, full-fidelity drill (the 1.0 data-safety proof).
 *
 * The existing `backup-restore.e2e-spec.ts` restores WITHIN the same running
 * instance and only checks object keys + bytes. This drill answers the real
 * "will my data survive an upgrade" question:
 *
 *   populate instance A (rich state) → whole-instance backup .zip →
 *   spawn a FRESH instance B (new DATA_DIR, fresh migrations, a DIFFERENT
 *   generated SSE key, same root creds/admin) → restore into B →
 *   assert rich fidelity on B, not just bytes.
 *
 * It asserts the ACTUAL restore behavior for every dimension. The backup manifest
 * is now **v2** (see `admin/backup/backup.service.ts` `BackupManifest`), which
 * closed the v1 data-loss gaps this drill originally documented: it captures the
 * full per-key version history plus per-bucket default-encryption / lifecycle /
 * CORS / policy, and on restore reapplies the bucket config (encryption FIRST)
 * BEFORE writing object bytes, so restored objects re-encrypt under B's own key.
 *
 * Fidelity matrix (what the v2 backup carries + restores):
 *   SURVIVES:  object bytes (current + ALL prior versions), Content-Type,
 *              user-metadata, object tags, bucket versioning status, per-bucket
 *              default-encryption config WITH at-rest re-encryption on B (the blob
 *              is ciphertext under B's key, not plaintext), lifecycle, CORS, policy.
 *
 * Two S3 read-path fixes surfaced by this drill (NOT backup defects) also landed
 * and are asserted: (#5) S3 `HEAD` emits the stored `x-amz-meta-*` response
 * headers, and (#2) GET/HEAD honour `?versionId`, so a specific version's bytes
 * are retrievable over the wire — on A (which holds the original version blobs)
 * AND on B (whose version history was rebuilt by the v2 restore).
 */

const PORT_A = 9280;
const PORT_B = 9281;
const PASSWORD = 'correct-horse-battery-staple';
const S3_CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Admin JSON API call against a specific instance port. */
function http(port: number, method: string, path: string, opts: { body?: unknown; bearer?: string } = {}): Promise<Res> {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = {};
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(data);
  }
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/** SigV4-signed S3 wire call against a specific instance port, with optional extra (signed) headers. */
function s3(
  port: number,
  method: string,
  path: string,
  opts: { body?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const reqOpts: aws4.Request = {
    host: `127.0.0.1:${port}`,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: { ...(opts.headers ?? {}) },
    body: opts.body,
  };
  aws4.sign(reqOpts, S3_CREDS);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, method, path, headers: reqOpts.headers, agent: false },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** GET returning raw response bytes (for the .zip download). */
function getBinary(port: number, path: string, bearer: string): Promise<{ status: number; ct?: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { authorization: `Bearer ${bearer}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, ct: res.headers['content-type'] as string, buf: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** POST a binary body (the .zip) on a restore endpoint. */
function sendBinary(port: number, method: string, path: string, body: Buffer, bearer: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'content-type': 'application/zip', 'content-length': body.length, authorization: `Bearer ${bearer}` },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function login(port: number): Promise<string> {
  const res = await http(port, 'POST', '/api/admin/auth/login', { body: { username: 'admin', password: PASSWORD } });
  return JSON.parse(res.body).accessToken as string;
}

/** Count <Version> blocks in a ListVersionsResult XML body. */
const countVersions = (xml: string) => (xml.match(/<Version>/g) ?? []).length;

// The distinctive plaintext of the at-rest-encrypted object. Long + marker-laden
// so an on-disk ciphertext comparison is unambiguous.
const SSE_PLAINTEXT = 'SUPER-SECRET-PLAINTEXT::' + 'the quick brown fox jumps over the lazy dog::'.repeat(4);

const VERSIONING_XML = '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>';
const ENCRYPTION_XML =
  '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault>' +
  '<SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>';
const CORS_XML =
  '<CORSConfiguration><CORSRule><ID>rule1</ID><AllowedOrigin>https://example.com</AllowedOrigin>' +
  '<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader>' +
  '<ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule></CORSConfiguration>';
const LIFECYCLE_XML =
  '<LifecycleConfiguration><Rule><ID>expire-tmp</ID><Status>Enabled</Status>' +
  '<Filter><Prefix>tmp/</Prefix></Filter><Expiration><Days>30</Days></Expiration></Rule></LifecycleConfiguration>';
const POLICY_JSON = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::vault/*' }],
});
const TAGGING_XML =
  '<Tagging><TagSet><Tag><Key>env</Key><Value>prod</Value></Tag>' +
  '<Tag><Key>team</Key><Value>data</Value></Tag></TagSet></Tagging>';

let appA: SpawnedApp;
let appB: SpawnedApp;

describe('Backup → fresh-instance restore full-fidelity drill (e2e)', () => {
  let backupZip: Buffer;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    // ---- Instance A: spawn + populate rich state ------------------------
    appA = await spawnApp(PORT_A, { ADMIN_PASSWORD_HASH: hash });
    const bearerA = await login(PORT_A);

    // (1) A versioning-ENABLED bucket with 3 versions of the same key.
    expect((await s3(PORT_A, 'PUT', '/vault')).status).toBeLessThan(300);
    expect((await s3(PORT_A, 'PUT', '/vault?versioning', { body: VERSIONING_XML })).status).toBeLessThan(300);
    expect((await s3(PORT_A, 'PUT', '/vault/doc.txt', { body: 'version-1' })).status).toBe(200);
    expect((await s3(PORT_A, 'PUT', '/vault/doc.txt', { body: 'version-2' })).status).toBe(200);
    expect((await s3(PORT_A, 'PUT', '/vault/doc.txt', { body: 'version-3-current' })).status).toBe(200);

    // (2) An object with user-metadata, an explicit Content-Type, and object tags.
    expect(
      (
        await s3(PORT_A, 'PUT', '/vault/rich.json', {
          body: '{"hello":"world"}',
          headers: { 'content-type': 'application/json', 'x-amz-meta-author': 'ada', 'x-amz-meta-purpose': 'fidelity-drill' },
        })
      ).status,
    ).toBe(200);
    expect((await s3(PORT_A, 'PUT', '/vault/rich.json?tagging', { body: TAGGING_XML })).status).toBeLessThan(300);

    // (3) An object encrypted AT REST (per-bucket default SSE-S3, instance key).
    expect((await s3(PORT_A, 'PUT', '/crypt')).status).toBeLessThan(300);
    expect((await s3(PORT_A, 'PUT', '/crypt?encryption', { body: ENCRYPTION_XML })).status).toBeLessThan(300);
    expect((await s3(PORT_A, 'PUT', '/crypt/secret.bin', { body: SSE_PLAINTEXT })).status).toBe(200);

    // (4) Non-default bucket config on `vault`: lifecycle + CORS + policy.
    expect((await s3(PORT_A, 'PUT', '/vault?cors', { body: CORS_XML })).status).toBeLessThan(300);
    expect((await s3(PORT_A, 'PUT', '/vault?lifecycle', { body: LIFECYCLE_XML })).status).toBeLessThan(300);
    expect(
      (await s3(PORT_A, 'PUT', '/vault?policy', { body: POLICY_JSON, headers: { 'content-type': 'application/json' } })).status,
    ).toBeLessThan(300);

    // Precondition sanity on A: the SSE object IS ciphertext on disk, yet GETs back plaintext.
    const diskA = readFileSync(join(appA.dataDir, 'blobs', 'crypt', 'secret.bin'));
    expect(diskA.toString('latin1')).not.toContain('SUPER-SECRET-PLAINTEXT'); // encrypted at rest on A
    expect((await s3(PORT_A, 'GET', '/crypt/secret.bin')).body).toBe(SSE_PLAINTEXT); // decrypts on read

    // Precondition sanity on A: 3 versions of doc.txt exist (scoped by prefix so
    // rich.json's own version does not inflate the count).
    expect(countVersions((await s3(PORT_A, 'GET', '/vault?versions&prefix=doc.txt')).body)).toBe(3);

    // (2b) Whole-instance backup .zip.
    const backup = await getBinary(PORT_A, '/api/admin/backup', bearerA);
    expect(backup.status).toBe(200);
    expect(backup.ct).toContain('application/zip');
    expect(backup.buf.subarray(0, 2).toString('latin1')).toBe('PK');
    backupZip = backup.buf;

    // ---- Instance B: FRESH DATA_DIR, fresh migrations, new generated SSE key --
    appB = await spawnApp(PORT_B, { ADMIN_PASSWORD_HASH: hash });
    const bearerB = await login(PORT_B);

    // Prove B is genuinely a different instance: its generated SSE key differs from A's.
    const keyA = readFileSync(join(appA.dataDir, 'sse.key'));
    const keyB = readFileSync(join(appB.dataDir, 'sse.key'));
    expect(appA.dataDir).not.toBe(appB.dataDir);
    expect(keyB.equals(keyA)).toBe(false);

    // B starts empty (no buckets), then we restore A's whole-instance backup into it.
    expect(JSON.parse((await http(PORT_B, 'GET', '/api/admin/buckets', { bearer: bearerB })).body).buckets).toEqual([]);
    const restore = await sendBinary(PORT_B, 'POST', '/api/admin/restore', backupZip, bearerB);
    expect([200, 201]).toContain(restore.status);
    const summary = JSON.parse(restore.body);
    expect(summary.bucketsRestored).toBe(2);
    // v2 restores every version write: doc.txt ×3 + rich.json ×1 (vault, versioned)
    // + secret.bin ×1 (crypt, unversioned) = 5 object writes.
    expect(summary.objectsRestored).toBe(5);
  }, 120_000);

  afterAll(async () => {
    appA?.kill('SIGKILL');
    appB?.kill('SIGKILL');
    await appA?.waitForExit();
    await appB?.waitForExit();
  });

  // ===================================================================
  // SURVIVES — dimensions the v1 backup faithfully round-trips into B.
  // ===================================================================

  it('SURVIVES: both buckets are recreated on B', async () => {
    const bearerB = await login(PORT_B);
    const names = (JSON.parse((await http(PORT_B, 'GET', '/api/admin/buckets', { bearer: bearerB })).body).buckets as {
      name: string;
    }[])
      .map((b) => b.name)
      .sort();
    expect(names).toEqual(['crypt', 'vault']);
  }, 30_000);

  it('SURVIVES: current object bytes are byte-exact on B', async () => {
    expect((await s3(PORT_B, 'GET', '/vault/doc.txt')).body).toBe('version-3-current');
    expect((await s3(PORT_B, 'GET', '/vault/rich.json')).body).toBe('{"hello":"world"}');
    expect((await s3(PORT_B, 'GET', '/crypt/secret.bin')).body).toBe(SSE_PLAINTEXT);
  }, 30_000);

  it('SURVIVES: Content-Type is preserved (S3 HEAD on B)', async () => {
    const head = await s3(PORT_B, 'HEAD', '/vault/rich.json');
    expect(head.status).toBe(200);
    expect(head.headers['content-type']).toContain('application/json');
  }, 30_000);

  it('SURVIVES: user-metadata is preserved at the persistence layer on B (admin metadata endpoint)', async () => {
    // User-metadata IS carried by the backup manifest (`obj.userMetadata`) and
    // re-applied on restore (`writer.put({ userMetadata })`), so it lands on B's
    // object row. We assert it through the admin metadata JSON endpoint — the
    // reliable read channel for it (see the S3-HEAD caveat test below).
    const bearerB = await login(PORT_B);
    const meta = JSON.parse((await http(PORT_B, 'GET', '/api/admin/buckets/vault/objects/rich.json', { bearer: bearerB })).body);
    expect(meta.userMetadata).toEqual({ author: 'ada', purpose: 'fidelity-drill' });
    expect(meta.contentType).toContain('application/json');
  }, 30_000);

  it('SURVIVES: S3 HEAD emits x-amz-meta-* headers (read-path fix #5)', async () => {
    // Read-path fix (issue #5): `headObject` now emits the stored user-metadata as
    // `x-amz-meta-<k>` response headers (standard S3), matching what the admin
    // metadata endpoint returns. Holds on BOTH instance A (freshly written) and
    // instance B (restored — user-metadata survives the backup manifest), so it is
    // a property of the S3 HEAD serializer, independent of backup/restore.
    const headA = await s3(PORT_A, 'HEAD', '/vault/rich.json');
    const headB = await s3(PORT_B, 'HEAD', '/vault/rich.json');
    expect(headA.headers['x-amz-meta-author']).toBe('ada');
    expect(headA.headers['x-amz-meta-purpose']).toBe('fidelity-drill');
    expect(headB.headers['x-amz-meta-author']).toBe('ada');
  }, 30_000);

  it('SURVIVES: object tags are preserved on B', async () => {
    const tag = await s3(PORT_B, 'GET', '/vault/rich.json?tagging');
    expect(tag.status).toBe(200);
    expect(tag.body).toContain('<Key>env</Key>');
    expect(tag.body).toContain('<Value>prod</Value>');
    expect(tag.body).toContain('<Key>team</Key>');
    expect(tag.body).toContain('<Value>data</Value>');
  }, 30_000);

  it('SURVIVES: bucket versioning status is preserved on B', async () => {
    const ver = await s3(PORT_B, 'GET', '/vault?versioning');
    expect(ver.status).toBe(200);
    expect(ver.body).toContain('<Status>Enabled</Status>');
  }, 30_000);

  it('SURVIVES (bytes): the at-rest-encrypted object round-trips across DIFFERENT instance SSE keys', async () => {
    // The backup stores DECRYPTED bytes, so B serves the original plaintext even
    // though B generated its OWN SSE key (asserted != A's in beforeAll). The
    // object bytes are NOT lost when the instance key changes — the key win.
    expect((await s3(PORT_B, 'GET', '/crypt/secret.bin')).body).toBe(SSE_PLAINTEXT);
  }, 30_000);

  // ===================================================================
  // FORMERLY GAPS — dimensions the v1 manifest dropped that the v2 manifest
  // now PRESERVES on restore. Each assertion is the flipped (now-survives)
  // proof of the fidelity fix.
  // ===================================================================

  it('SURVIVES: all prior object versions are restored on B (was DROPPED in v1)', async () => {
    // A had 3 versions of doc.txt. The v2 backup captures the full version history
    // and the restore replays every version in order into B's (versioning-enabled)
    // `vault`, so B's version listing shows all 3 — not just the current pointer.
    const list = await s3(PORT_B, 'GET', '/vault?versions&prefix=doc.txt');
    expect(list.status).toBe(200);
    expect(countVersions(list.body)).toBe(3); // was 1 under v1
  }, 30_000);

  it('SURVIVES: GET ?versionId retrieves a specific prior version on BOTH A and B', async () => {
    // Read-path fix (issue #2): the S3 read path honours `?versionId`. On A (original
    // version blobs) the oldest version reads back its bytes; and now on B — whose
    // version history was rebuilt by the v2 restore — the oldest of B's OWN
    // (regenerated) version ids also serves `version-1`, proving history survived.
    const versionsA = (await s3(PORT_A, 'GET', '/vault?versions&prefix=doc.txt')).body;
    const idsA = [...versionsA.matchAll(/<VersionId>([^<]+)<\/VersionId>/g)].map((m) => m[1]);
    expect(idsA.length).toBe(3);
    const oldestA = idsA[idsA.length - 1]; // uuidv7 sorts newest-first in the listing
    const gotA = await s3(PORT_A, 'GET', `/vault/doc.txt?versionId=${oldestA}`);
    expect(gotA.body).toBe('version-1');
    expect(gotA.headers['x-amz-version-id']).toBe(oldestA);
    expect((await s3(PORT_A, 'GET', '/vault/doc.txt')).body).toBe('version-3-current');

    // B: same property against B's regenerated version ids.
    const versionsB = (await s3(PORT_B, 'GET', '/vault?versions&prefix=doc.txt')).body;
    const idsB = [...versionsB.matchAll(/<VersionId>([^<]+)<\/VersionId>/g)].map((m) => m[1]);
    expect(idsB.length).toBe(3);
    const oldestB = idsB[idsB.length - 1];
    const gotB = await s3(PORT_B, 'GET', `/vault/doc.txt?versionId=${oldestB}`);
    expect(gotB.body).toBe('version-1'); // the requested prior version survived the restore
    expect(gotB.headers['x-amz-version-id']).toBe(oldestB);
    expect((await s3(PORT_B, 'GET', '/vault/doc.txt')).body).toBe('version-3-current');
  }, 30_000);

  it('SURVIVES: per-bucket default-encryption config + at-rest RE-ENCRYPTION on B (was DROPPED in v1)', async () => {
    // The v2 manifest captures `bucket.encryption`, and the restore applies it
    // BEFORE writing object bytes — so B's `crypt` bucket reports its default SSE...
    const enc = await s3(PORT_B, 'GET', '/crypt?encryption');
    expect(enc.status).toBe(200);
    expect(enc.body).toContain('<SSEAlgorithm>AES256</SSEAlgorithm>');

    // ...and the restored blob is written ENCRYPTED at rest under B's OWN SSE key
    // (which differs from A's — asserted in beforeAll). The at-rest-encryption
    // PROPERTY is preserved, not silently downgraded to plaintext.
    const diskB = readFileSync(join(appB.dataDir, 'blobs', 'crypt', 'secret.bin'));
    expect(diskB.toString('latin1')).not.toContain('SUPER-SECRET-PLAINTEXT'); // ciphertext on B
    // And it still decrypts correctly on read (round-trip under B's key).
    expect((await s3(PORT_B, 'GET', '/crypt/secret.bin')).body).toBe(SSE_PLAINTEXT);
  }, 30_000);

  it('SURVIVES: bucket lifecycle config round-trips on B (was DROPPED in v1)', async () => {
    const lc = await s3(PORT_B, 'GET', '/vault?lifecycle');
    expect(lc.status).toBe(200);
    expect(lc.body).toContain('<ID>expire-tmp</ID>');
    expect(lc.body).toContain('<Prefix>tmp/</Prefix>');
    expect(lc.body).toContain('<Days>30</Days>');
  }, 30_000);

  it('SURVIVES: bucket CORS config round-trips on B (was DROPPED in v1)', async () => {
    const cors = await s3(PORT_B, 'GET', '/vault?cors');
    expect(cors.status).toBe(200);
    expect(cors.body).toContain('<AllowedOrigin>https://example.com</AllowedOrigin>');
    expect(cors.body).toContain('<MaxAgeSeconds>3000</MaxAgeSeconds>');
  }, 30_000);

  it('SURVIVES: bucket policy round-trips on B (was DROPPED in v1)', async () => {
    const pol = await s3(PORT_B, 'GET', '/vault?policy');
    expect(pol.status).toBe(200);
    expect(pol.body).toContain('"Sid":"PublicRead"');
    expect(pol.body).toContain('arn:aws:s3:::vault/*');
  }, 30_000);
});
