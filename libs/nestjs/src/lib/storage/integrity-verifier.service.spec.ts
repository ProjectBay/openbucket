import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { ConfigService } from '@nestjs/config';

import { BlobStore } from './blob-store';
import { IntegrityVerifier } from './integrity-verifier.service';
import { generateIv, encryptBuffer, SSE_KEY_BYTES } from './sse-cipher';
import type { SseKeyService } from './sse-key.service';

const TMP_ROOT = join(process.cwd(), 'tmp', 'openbucket-integrity-verifier-test');
const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;

/**
 * TEST-1204 — the shared re-hashing core used by both the F1 read gate and the
 * background scrubber. Exercises ok / corrupt / SSE / ENOENT against a real
 * temporary DATA_DIR.
 */
describe('IntegrityVerifier (TEST-1204)', () => {
  let dataDir: string;
  let store: BlobStore;
  let verifier: IntegrityVerifier;
  const key = Buffer.alloc(SSE_KEY_BYTES, 0x7);
  const sseKey = { key: () => key } as unknown as SseKeyService;

  beforeEach(async () => {
    dataDir = join(TMP_ROOT, randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
    store = new BlobStore(stubConfig(dataDir));
    verifier = new IntegrityVerifier(store, sseKey);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('case 1: verify returns ok=true for an intact plaintext blob', async () => {
    const buf = Buffer.from('hello integrity world');
    const { sha256 } = await store.putBlob('b', 'k', Readable.from([buf]));
    const res = await verifier.verify('b', 'k', sha256);
    expect(res.ok).toBe(true);
    expect(res.actualSha256).toBe(sha256);
    expect(res.bytesHashed).toBe(BigInt(buf.length));
  });

  it('case 2: verify returns ok=false (no throw) when bytes are flipped on disk', async () => {
    const buf = Buffer.from('the quick brown fox');
    const { sha256, finalPath } = await store.putBlob('b', 'k', Readable.from([buf]));
    // Corrupt one byte on disk.
    const onDisk = await fs.readFile(finalPath);
    onDisk[0] = onDisk[0] ^ 0xff;
    await fs.writeFile(finalPath, onDisk);

    const res = await verifier.verify('b', 'k', sha256);
    expect(res.ok).toBe(false);
    expect(res.actualSha256).not.toBe(sha256);
  });

  it('case 3: verify decrypts an SSE-S3 blob and hashes the PLAINTEXT digest', async () => {
    const plaintext = Buffer.from('secret contents that are encrypted at rest');
    const iv = generateIv();
    const ciphertext = encryptBuffer(key, iv, plaintext);
    // Write the ciphertext directly as the on-disk blob.
    await store.putBlob('b', 'enc', Readable.from([ciphertext]));

    const expected = createHash('sha256').update(plaintext).digest('hex');
    const res = await verifier.verify('b', 'enc', expected, {
      encryption: { iv: iv.toString('base64') },
    });
    expect(res.ok).toBe(true);
    expect(res.actualSha256).toBe(expected);
    expect(res.bytesHashed).toBe(BigInt(plaintext.length));
  });

  it('case 4: a missing blob rejects with ENOENT (not a corrupt verdict)', async () => {
    await expect(verifier.verify('b', 'missing', 'deadbeef')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('case 5: recompute always reports ok=true and the actual digest', async () => {
    const buf = Buffer.from('recompute me');
    await store.putBlob('b', 'k', Readable.from([buf]));
    const res = await verifier.recompute('b', 'k');
    expect(res.ok).toBe(true);
    expect(res.actualSha256).toBe(createHash('sha256').update(buf).digest('hex'));
  });
});
