// Attack: bit-rot / corruption at rest.
//
// Expected (S3 durability contract): a GET must not silently return corrupted
// bytes. Either the store verifies content on read and fails the GET, or it is
// physically impossible for stored bytes to change undetected.
//
// This flips one byte in the on-disk blob and re-reads via the S3 API.
import {
  spawnApp, s3, s3cmds, blobFiles, flipByte, readBody, check, finding, summary, rnd,
} from './harness.mjs';

const app = await spawnApp();
const { CreateBucketCommand, PutObjectCommand, GetObjectCommand } = s3cmds();
const c = s3(app.port);
const bucket = 'corrupt-' + rnd();
const key = 'obj.bin';
const original = Buffer.from('THE-QUICK-BROWN-FOX-JUMPS-'.repeat(64)); // ~1.6 KB, recognizable

let violations = 0;
try {
  await c.send(new CreateBucketCommand({ Bucket: bucket }));
  const put = await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: original }));
  const etag0 = put.ETag;

  // sanity: happy-path GET matches
  const g0 = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const b0 = await readBody(g0.Body);
  check('sanity: GET returns the stored bytes before corruption', b0.equals(original));

  // corrupt one byte in the on-disk blob
  const blobs = blobFiles(app.dataDir).sort((a, b) => b.size - a.size);
  check('a blob payload file exists on disk', blobs.length >= 1, `blobs found: ${blobs.length}`);
  const blob = blobs[0];
  const offset = Math.floor(blob.size / 2);
  flipByte(blob.path, offset);
  console.log(`  · flipped byte @${offset} of ${blob.path} (${blob.size}B)`);

  // GET after corruption — the guarantee under test
  let errored = false, served = null, etag1 = null, httpStatus = 200;
  try {
    const g1 = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    served = await readBody(g1.Body);
    etag1 = g1.ETag;
  } catch (e) {
    errored = true;
    httpStatus = e?.$metadata?.httpStatusCode;
  }

  const identical = served && served.equals(original);
  const guaranteeHeld = errored || identical;
  check('GET does not silently serve corrupted bytes (errors, or is unaffected)', guaranteeHeld);

  if (!guaranteeHeld) {
    violations++;
    const diffs = served.reduce((n, byte, i) => n + (byte !== original[i] ? 1 : 0), 0);
    finding(
      'SILENT CORRUPTION AT REST',
      `GET returned HTTP 200 with ${served.length}B of CORRUPTED data ` +
        `(${diffs} byte(s) differ from what was PUT). ` +
        `ETag header = ${etag1} (original ${etag0}; recomputed-from-disk = ${etag1 !== etag0 ? 'yes' : 'NO — stale stored ETag served alongside corrupt bytes'}).`,
    );
    console.log('  EXPECTED: GET fails with a corruption/checksum error (or bytes cannot change undetected).');
    console.log('  OBSERVED: GET returns corrupted bytes + 200 + the original ETag. Caller cannot tell.');
    console.log('  ROOT CAUSE: object.service.ts getObject streams raw bytes, ETag from DB row never recomputed;');
    console.log('              SSE is AES-256-CTR (no MAC, sse-cipher.ts:15); no scrub/repair path.');
  } else if (errored) {
    console.log(`  HELD: GET detected corruption (HTTP ${httpStatus}).`);
  }
} finally {
  app.kill();
  await app.waitExit();
}
process.exit(summary('corruption-at-rest') + violations);
