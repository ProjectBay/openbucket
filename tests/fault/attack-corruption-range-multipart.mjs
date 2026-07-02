// Attack: corruption at rest must be detected on RANGE reads and for MULTIPART
// objects too — the gaps F1 originally left open (only single-part full GETs were
// verified). Now getObject stores a whole-object SHA-256 (contentSha256) and
// verifies it before sending, covering multipart (whose ETag is md5-of-md5s) and
// small-enough Range reads.
import {
  spawnApp, s3cmds, blobFiles, flipByte, readBody, check, finding, summary, rnd,
  ROOT_ACCESS_KEY_ID, ROOT_SECRET_ACCESS_KEY,
} from './harness.mjs';

const {
  S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} = s3cmds();

const app = await spawnApp();
// Checksum-disabled client so multipart UploadPart sends a plain body.
const c = new S3Client({
  endpoint: `http://127.0.0.1:${app.port}`, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: ROOT_ACCESS_KEY_ID, secretAccessKey: ROOT_SECRET_ACCESS_KEY },
  maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
});

const blobFor = (bucket) =>
  blobFiles(app.dataDir).filter((f) => f.path.includes(bucket)).sort((a, b) => b.size - a.size)[0];

let violations = 0;
try {
  // ---- Test 1: Range GET over a corrupted (small) single-part object ----
  const b1 = 'rng-' + rnd();
  await c.send(new CreateBucketCommand({ Bucket: b1 }));
  const body1 = Buffer.from('SINGLE-PART-RANGE-BODY-'.repeat(64)); // ~1.5 KB, under the range-verify cap
  await c.send(new PutObjectCommand({ Bucket: b1, Key: 'obj', Body: body1 }));
  const mid = Math.floor(body1.length / 2);
  flipByte(blobFor(b1).path, mid);
  let rangeErrored = false, rangeStatus = 200;
  try {
    const g = await c.send(new GetObjectCommand({ Bucket: b1, Key: 'obj', Range: `bytes=${mid - 40}-${mid + 40}` }));
    await readBody(g.Body);
  } catch (e) { rangeErrored = true; rangeStatus = e?.$metadata?.httpStatusCode; }
  check('Range GET over a corrupted small object is detected, not served', rangeErrored, rangeErrored ? `HTTP ${rangeStatus}` : '');
  if (!rangeErrored) {
    violations++;
    finding('RANGE READ SERVES CORRUPTED BYTES', 'a Range GET over a flipped byte returned 200 instead of a 500.');
  }

  // ---- Test 2: Full GET of a corrupted MULTIPART object ----
  const b2 = 'mp-' + rnd();
  await c.send(new CreateBucketCommand({ Bucket: b2 }));
  const part = Buffer.from('MULTIPART-COMPOSED-BODY-'.repeat(64));
  const up0 = await c.send(new CreateMultipartUploadCommand({ Bucket: b2, Key: 'obj' }));
  const p1 = await c.send(new UploadPartCommand({ Bucket: b2, Key: 'obj', UploadId: up0.UploadId, PartNumber: 1, Body: part }));
  await c.send(new CompleteMultipartUploadCommand({
    Bucket: b2, Key: 'obj', UploadId: up0.UploadId,
    MultipartUpload: { Parts: [{ PartNumber: 1, ETag: p1.ETag }] },
  }));
  const composed = blobFor(b2);
  flipByte(composed.path, Math.floor(composed.size / 2));
  let mpErrored = false, mpStatus = 200;
  try {
    const g = await c.send(new GetObjectCommand({ Bucket: b2, Key: 'obj' }));
    await readBody(g.Body);
  } catch (e) { mpErrored = true; mpStatus = e?.$metadata?.httpStatusCode; }
  check('Full GET of a corrupted MULTIPART object is detected, not served', mpErrored, mpErrored ? `HTTP ${mpStatus}` : '');
  if (!mpErrored) {
    violations++;
    finding('MULTIPART READ SERVES CORRUPTED BYTES', 'a full GET of a flipped multipart object returned 200 instead of a 500 (etag is md5-of-md5s; contentSha256 must catch it).');
  }
} finally {
  app.kill();
  await app.waitExit();
}
process.exit(summary('corruption-range-multipart') + violations);
