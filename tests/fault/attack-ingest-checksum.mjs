// Attack: end-to-end integrity on ingest via x-amz-checksum-*.
//
// Expected (S3 flexible checksums): if a client sends x-amz-checksum-sha256,
// the server verifies the received body against it and rejects a mismatch with
// BadDigest. OpenBucket only validates Content-MD5 / x-amz-content-sha256 on a
// regular PUT; x-amz-checksum-{sha256,sha1,crc32c} are ignored unless sent as a
// chunked trailer (chunked-decoder.ts:196-211). A client trusting that checksum
// for transit integrity gets silent acceptance of corrupted data.
//
// The AWS SDK computes checksums for you, so to send a *wrong* one we sign the
// request by hand with aws4.
import { spawnApp, s3, s3cmds, check, finding, summary, rnd, ROOT_ACCESS_KEY_ID, ROOT_SECRET_ACCESS_KEY } from './harness.mjs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';

const require = createRequire(import.meta.url);
const aws4 = require('aws4');
const { CreateBucketCommand } = s3cmds();

function rawPut(port, bucket, key, body, extraHeaders) {
  const opts = {
    host: `127.0.0.1:${port}`,
    path: `/${bucket}/${key}`,
    method: 'PUT',
    service: 's3',
    region: 'us-east-1',
    headers: { ...extraHeaders },
    body,
  };
  aws4.sign(opts, { accessKeyId: ROOT_ACCESS_KEY_ID, secretAccessKey: ROOT_SECRET_ACCESS_KEY });
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: opts.path, method: 'PUT', headers: opts.headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); },
    );
    req.on('error', (e) => resolve({ status: -1, body: String(e) }));
    req.end(body);
  });
}

const app = await spawnApp();
const c = s3(app.port);
const bucket = 'chk-' + rnd();
let violations = 0;
try {
  await c.send(new CreateBucketCommand({ Bucket: bucket }));
  const body = Buffer.from('hello world checksum test');

  // CONTROL — a wrong Content-MD5 must be rejected. Proves the harness can drive
  // the ingest path and that *some* integrity is enforced.
  const wrongMd5 = crypto.createHash('md5').update('DIFFERENT').digest('base64');
  const ctl = await rawPut(app.port, bucket, 'ctl.bin', body, { 'content-md5': wrongMd5 });
  check('CONTROL: a wrong Content-MD5 is rejected (400 BadDigest)', ctl.status === 400, `got HTTP ${ctl.status}: ${ctl.body.slice(0, 100)}`);

  // UNDER TEST — a wrong x-amz-checksum-sha256 on a regular PUT.
  const wrongSha = crypto.createHash('sha256').update('DIFFERENT').digest('base64');
  const r = await rawPut(app.port, bucket, 'sha.bin', body, { 'x-amz-checksum-sha256': wrongSha });
  const rejected = r.status === 400;
  check('a wrong x-amz-checksum-sha256 on a regular PUT is rejected', rejected, `got HTTP ${r.status}: ${r.body.slice(0, 100)}`);

  if (!rejected) {
    violations++;
    finding(
      'x-amz-checksum-sha256 IGNORED on a regular PUT',
      `PUT with a deliberately-wrong x-amz-checksum-sha256 returned HTTP ${r.status} (accepted). ` +
        `A client that relies on this header for end-to-end integrity gets silent acceptance of corrupt-in-transit data. ` +
        `Only chunked-upload crc32 trailers are validated (chunked-decoder.ts:205-211); a regular PUT checks only Content-MD5 / x-amz-content-sha256.`,
    );
  }
} finally {
  app.kill();
  await app.waitExit();
}
process.exit(summary('ingest-checksum') + violations);
