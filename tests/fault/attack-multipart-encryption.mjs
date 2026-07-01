// Attack: multipart uploads must honour a bucket's default SSE-S3 encryption.
//
// Expected: with bucket default AES256 encryption, objects are ciphertext at
// rest regardless of how they were uploaded. Previously the multipart compose
// path wrote plaintext (no cipher), so a multipart object landed unencrypted on
// disk while single-shot PUTs were encrypted (F5 — silent confidentiality loss).
import {
  spawnApp, s3cmds, blobFiles, readBody, check, finding, summary, rnd,
  ROOT_ACCESS_KEY_ID, ROOT_SECRET_ACCESS_KEY,
} from './harness.mjs';
import { readFileSync } from 'node:fs';

const {
  S3Client, CreateBucketCommand, PutBucketEncryptionCommand, PutObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  GetObjectCommand,
} = s3cmds();

const app = await spawnApp();
// Disable the SDK's default flexible-checksum (WHEN_SUPPORTED) so UploadPart
// sends a plain body — otherwise the SDK uses aws-chunked framing for parts and
// the part-ETag check rejects Complete. This test is about at-rest encryption,
// not the checksum path (covered by attack-ingest-checksum).
const c = new S3Client({
  endpoint: `http://127.0.0.1:${app.port}`,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: ROOT_ACCESS_KEY_ID, secretAccessKey: ROOT_SECRET_ACCESS_KEY },
  maxAttempts: 1,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
const bucket = 'enc-' + rnd();
const marker = `PLAINTEXT-SECRET-${rnd()}`;
const body = Buffer.from(marker.repeat(64)); // recognizable plaintext on disk
let violations = 0;

try {
  await c.send(new CreateBucketCommand({ Bucket: bucket }));
  await c.send(
    new PutBucketEncryptionCommand({
      Bucket: bucket,
      ServerSideEncryptionConfiguration: {
        Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
    }),
  );

  // single-shot (control — known to encrypt) + multipart (under test)
  await c.send(new PutObjectCommand({ Bucket: bucket, Key: 'single', Body: body }));
  const mp = await c.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'multi' }));
  const up = await c.send(
    new UploadPartCommand({ Bucket: bucket, Key: 'multi', UploadId: mp.UploadId, PartNumber: 1, Body: body }),
  );
  await c.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket, Key: 'multi', UploadId: mp.UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: up.ETag }] },
    }),
  );

  // No on-disk blob may contain the plaintext marker.
  const leaks = blobFiles(app.dataDir).filter((b) => readFileSync(b.path).includes(marker));
  check('no object is stored as plaintext on an encrypted bucket', leaks.length === 0,
    leaks.length ? `plaintext in: ${leaks.map((b) => b.path).join(', ')}` : '');
  if (leaks.length) {
    violations++;
    finding('MULTIPART/OBJECT BYPASSES SSE-S3 ENCRYPTION',
      `${leaks.length} on-disk blob(s) contain plaintext despite bucket default AES256 encryption.`);
  }

  // Both must still GET back correctly (decrypt path works).
  const gm = await readBody((await c.send(new GetObjectCommand({ Bucket: bucket, Key: 'multi' }))).Body);
  check('multipart object round-trips (encrypts on write, decrypts on read)', gm.equals(body));
} finally {
  app.kill();
  await app.waitExit();
}
process.exit(summary('multipart-encryption') + violations);
