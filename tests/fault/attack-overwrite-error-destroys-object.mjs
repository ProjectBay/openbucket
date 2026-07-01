// Attack: a FAILED overwrite must not destroy the existing object.
//
// Expected (S3): PutObject is atomic — a failed PUT is a no-op; the prior
// object (which returned a 200) remains durable and readable.
//
// OpenBucket renames the new blob over the old one BEFORE committing the row
// (object-writer.service.ts:90), and on ANY post-rename error the catch does
// fs.unlink(finalPath) (object-writer.service.ts:135). For an overwrite that
// leaves the committed OLD row pointing at a DELETED blob — data loss on a
// failed write. We inject the post-rename error with OB_FAULT_MODE=throw
// (simulating a disk/commit error at the write's tail).
import {
  spawnApp, s3, s3cmds, readBody, check, finding, summary, rnd, scratchDir,
} from './harness.mjs';

const { CreateBucketCommand, PutObjectCommand, GetObjectCommand } = s3cmds();
const dataDir = scratchDir('data');
const bucket = 'ovw-' + rnd();
const key = 'important.txt';
const v1 = Buffer.from('ORIGINAL-DURABLE-DATA-'.repeat(32));
const v2 = Buffer.from('replacement-bytes-'.repeat(8));
let violations = 0;

// Phase 1 — durably store v1 (no fault).
let app = await spawnApp({ dataDir });
let c = s3(app.port);
await c.send(new CreateBucketCommand({ Bucket: bucket }));
await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: v1 }));
const g1 = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
check('phase 1: v1 is durably stored and readable (got its 200)', (await readBody(g1.Body)).equals(v1));
app.kill(); await app.waitExit();

// Phase 2 — overwrite with v2; inject an error AFTER the rename, BEFORE commit.
app = await spawnApp({ dataDir, fault: 'after-rename', env: { OB_FAULT_MODE: 'throw' } });
c = s3(app.port);
let putFailed = false, putErr = '';
try {
  await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: v2 }));
} catch (e) {
  putFailed = true;
  putErr = `${e?.name} ${e?.$metadata?.httpStatusCode ?? ''}`;
}
check('phase 2: the faulty overwrite reported failure to the client', putFailed, putErr);

// Phase 3 — the atomicity guarantee: is the ORIGINAL still intact?
let getStatus = 200, body = null, errName = '';
try {
  const g = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  body = await readBody(g.Body);
} catch (e) {
  getStatus = e?.$metadata?.httpStatusCode ?? -1;
  errName = e?.name ?? String(e);
}
const survived = body && body.equals(v1);
check('phase 3: a FAILED overwrite leaves the original object intact', survived);

if (!survived) {
  violations++;
  finding(
    'FAILED OVERWRITE DESTROYS THE PREVIOUSLY-DURABLE OBJECT',
    body
      ? `GET now returns ${body.length}B that are NOT the original.`
      : `GET now fails (${errName}, HTTP ${getStatus}) — the object that had a 200 is GONE.`,
  );
  console.log('  EXPECTED: the overwrite fails atomically; GET still returns v1 (a failed write is a no-op).');
  console.log('  OBSERVED: the original object is lost. The committed v1 row points at a blob the error');
  console.log('            path deleted (object-writer.service.ts:135 fs.unlink(finalPath)).');
  console.log('  CONTRADICTS whitepaper 03-persistence §3.7.3:1830 "row committed, file missing — prevented by construction".');
}
app.kill(); await app.waitExit();
console.log(`  (data dir: ${dataDir})`);
process.exit(summary('overwrite-error-destroys-object') + violations);
