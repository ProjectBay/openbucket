// Attack: crash (SIGKILL / power cut) between the blob rename and the metadata
// commit, on an OVERWRITE.
//
// Expected (S3): after a crash, the object is EITHER the old version OR the new
// version — never a mix. Its metadata (size, ETag) must describe its bytes.
//
// OpenBucket renames the new blob over the old (object-writer.service.ts:90)
// BEFORE committing the row (:129). A crash in between leaves the committed OLD
// row (old size/ETag) describing the NEW file bytes. getObject serves
// Content-Length from the row (object.service.ts:419) while streaming the new
// file -> a torn / short / mislabelled read that recovery never detects
// (recovery.service.ts has no reverse or content pass).
import {
  spawnApp, s3, s3cmds, readBody, check, finding, summary, rnd, scratchDir,
} from './harness.mjs';

const { CreateBucketCommand, PutObjectCommand, GetObjectCommand } = s3cmds();
const dataDir = scratchDir('data');
const bucket = 'crash-' + rnd();
const key = 'doc.bin';
const v1 = Buffer.alloc(500, 0x41); // 500 bytes of 'A'
const v2 = Buffer.alloc(20, 0x42); //  20 bytes of 'B'
let violations = 0;

// Phase 1 — durably store v1 (500B), no fault.
let app = await spawnApp({ dataDir });
let c = s3(app.port);
await c.send(new CreateBucketCommand({ Bucket: bucket }));
const p1 = await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: v1 }));
const etag1 = p1.ETag;
check('phase 1: v1 (500B) stored', (await readBody((await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body)).equals(v1));
app.kill(); await app.waitExit();

// Phase 2 — overwrite with v2 (20B); CRASH after rename, before commit.
app = await spawnApp({ dataDir, fault: 'after-rename' }); // default mode = crash (process.exit)
c = s3(app.port);
let crashed = false;
try {
  await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: v2 }));
} catch {
  crashed = true; // connection reset — the app exited mid-request
}
await app.waitExit();
check('phase 2: the app crashed mid-overwrite (after rename, before commit)', crashed && app.exited());

// Phase 3 — restart clean and read the object back.
app = await spawnApp({ dataDir });
c = s3(app.port);
let contentLength = null, etag = null, bodyLen = null, body = null, errName = '';
try {
  const g = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  contentLength = g.ContentLength;
  etag = g.ETag;
  body = await readBody(g.Body);
  bodyLen = body.length;
} catch (e) {
  errName = `${e?.name}`;
}

console.log(`  · after crash: declared Content-Length=${contentLength}, ETag=${etag}, actual bytes read=${bodyLen}${errName ? ', GET error=' + errName : ''}`);

const isCleanV1 = body && body.equals(v1) && contentLength === 500 && etag === etag1;
const isCleanV2 = body && body.equals(v2);
const consistent = isCleanV1 || isCleanV2;
check('phase 3: object is a clean whole version (all v1 or all v2), metadata matches bytes', consistent);

if (!consistent) {
  violations++;
  finding(
    'CRASH LEAVES A ROW↔CONTENT MISMATCH (torn/short read)',
    errName
      ? `GET failed (${errName}) — the response declared Content-Length ${contentLength} but the blob is the new ${v2.length}B; the HTTP body is truncated/inconsistent.`
      : `GET returned ${bodyLen}B with declared Content-Length=${contentLength} and ETag=${etag} (v1's), but the bytes are the NEW version. Metadata describes v1; content is v2.`,
  );
  console.log('  EXPECTED: after a crash the object is atomically v1 or v2, with metadata matching its bytes.');
  console.log('  OBSERVED: committed row = v1 (size 500 / etag ' + etag1 + '), on-disk blob = v2 (20B). Silent mismatch.');
  console.log('  Recovery (recovery.service.ts) never detects this: no reverse pass, no content check.');
}
app.kill(); await app.waitExit();
console.log(`  (data dir: ${dataDir})`);
process.exit(summary('crash-overwrite-mismatch') + violations);
