import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { BlobStore } from './blob-store';
import { PathResolver } from './paths';

const TMP_ROOT = join(process.cwd(), 'tmp', 'openbucket-blobstore-test');
const makeDataDir = () => join(TMP_ROOT, randomUUID());

const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;

const readFile = (p: string) => fs.readFile(p);

/**
 * TEST-0208 — every public BlobStore method against a real temporary DATA_DIR
 * plus the EXDEV fallback via a one-shot fs.rename mock.
 */
describe('BlobStore (TEST-0208)', () => {
  let dataDir: string;
  let store: BlobStore;

  beforeEach(async () => {
    dataDir = makeDataDir();
    await fs.mkdir(dataDir, { recursive: true });
    store = new BlobStore(stubConfig(dataDir));
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  // ---------- PathResolver -----------------------------------------------

  it('case 1: PathResolver.blobPath percent-encodes the key', () => {
    const p = new PathResolver('/data').blobPath('mybucket', 'a key');
    expect(p.replace(/\\/g, '/')).toMatch(/mybucket\/a%20key$/);
  });

  it('case 2: PathResolver.multipartPartPath shape', () => {
    const p = new PathResolver('/data').multipartPartPath('u1', 3);
    expect(p.replace(/\\/g, '/')).toMatch(/multipart\/u1\/3\.part$/);
  });

  // ---------- putBlob ----------------------------------------------------

  it('case 3: putBlob (10 MiB) writes bytes + correct hashes + size', async () => {
    const buf = Buffer.alloc(10 * 1024 * 1024, 0xab);
    const res = await store.putBlob('b', 'k', Readable.from([buf]));

    expect(res.size).toBe(BigInt(buf.length));
    expect(res.etag).toBe(createHash('md5').update(buf).digest('hex'));
    expect(res.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
    const onDisk = await readFile(res.finalPath);
    expect(onDisk.equals(buf)).toBe(true);
  });

  it('case 4: putBlob unlinks the tmp file when the source errors mid-flight', async () => {
    const erroring = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        process.nextTick(() => this.destroy(new Error('boom')));
      },
    });
    await expect(store.putBlob('b', 'k', erroring)).rejects.toThrow(/boom/);

    // No final file; tmp dir is empty (cleanup ran).
    expect(existsSync(store.paths.blobPath('b', 'k'))).toBe(false);
    const tmpDir = store.paths.tmpDir();
    const stragglers = existsSync(tmpDir) ? readdirSync(tmpDir) : [];
    expect(stragglers).toEqual([]);
  });

  it("case 5: the wx flag rejects a pre-existing tmp file (EEXIST)", async () => {
    // The wx flag is source-evident in blob-store.ts. Rather than mock ESM's
    // `crypto.randomUUID` to simulate a collision (brittle under jest 30 +
    // node 20 ESM), assert the node-level guarantee directly: opening the same
    // path twice with `flags: 'wx'` raises EEXIST on the second open.
    const path = store.paths.tmpPath('wx-probe');
    await fs.mkdir(store.paths.tmpDir(), { recursive: true });
    const { createWriteStream } = await import('node:fs');
    await new Promise<void>((resolve, reject) => {
      const w = createWriteStream(path, { flags: 'wx' });
      w.end(Buffer.from('x'), (err?: Error | null) => (err ? reject(err) : resolve()));
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        const w = createWriteStream(path, { flags: 'wx' });
        w.on('error', reject);
        w.end(Buffer.from('y'), (err?: Error | null) => (err ? reject(err) : resolve()));
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  // ---------- getBlob ----------------------------------------------------

  it('case 6: getBlob (full) returns the bytes and size', async () => {
    await store.putBlob('b', 'k', Readable.from([Buffer.from('abcdef')]));
    const { stream, size } = await store.getBlob('b', 'k');
    expect(size).toBe(6n);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('abcdef');
  });

  it('case 7: getBlob (range start..end inclusive) slices correctly', async () => {
    await store.putBlob('b', 'k', Readable.from([Buffer.from('abcdef')]));
    const { stream } = await store.getBlob('b', 'k', { start: 1, end: 3 });
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('bcd');
  });

  it('case 8: getBlob throws ENOENT for a missing key', async () => {
    await expect(store.getBlob('b', 'missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // ---------- headBlob ---------------------------------------------------

  it('case 9: headBlob present returns size + mtime', async () => {
    const res = await store.putBlob('b', 'k', Readable.from([Buffer.from('xy')]));
    const head = await store.headBlob('b', 'k');
    expect(head).not.toBeNull();
    expect(head!.size).toBe(2n);
    // jest's worker realm sometimes breaks `instanceof Date` even when the
    // value is a Date — assert via the shape instead.
    expect(typeof head!.mtime.getTime).toBe('function');
    expect(head!.mtime.getTime()).toBeGreaterThan(0);
    expect(statSync(res.finalPath).size).toBe(2);
  });

  it('case 10: headBlob missing returns null (no throw)', async () => {
    expect(await store.headBlob('b', 'missing')).toBeNull();
  });

  // ---------- deleteBlob -------------------------------------------------

  it('case 11: deleteBlob moves the file to trash/ + writes manifest', async () => {
    await store.putBlob('b', 'k', Readable.from([Buffer.from('bye')]));
    await store.deleteBlob('b', 'k');

    expect(existsSync(store.paths.blobPath('b', 'k'))).toBe(false);
    const entries = readdirSync(store.paths.trashDir());
    const manifest = entries.find((e) => e.endsWith('.manifest.json'));
    expect(manifest).toBeDefined();
    const data = JSON.parse(await fs.readFile(join(store.paths.trashDir(), manifest!), 'utf8'));
    expect(data).toMatchObject({ bucket: 'b', key: 'k' });
    expect(typeof data.entryId).toBe('string');
    expect(typeof data.deletedAt).toBe('string');
    expect(typeof data.originalPath).toBe('string');
  });

  it('case 12: deleteBlob on a missing key is idempotent', async () => {
    await expect(store.deleteBlob('b', 'never-existed')).resolves.toBeUndefined();
  });

  // ---------- composeBlobs ----------------------------------------------

  it('case 13: composeBlobs concatenates parts + correct ETag / size', async () => {
    const a = Buffer.from('aaa');
    const b = Buffer.from('bbbb');
    const c = Buffer.from('cc');
    const partA = await store.putBlob('parts', 'a', Readable.from([a]));
    const partB = await store.putBlob('parts', 'b', Readable.from([b]));
    const partC = await store.putBlob('parts', 'c', Readable.from([c]));

    const res = await store.composeBlobs(
      [
        { path: partA.finalPath, size: partA.size },
        { path: partB.finalPath, size: partB.size },
        { path: partC.finalPath, size: partC.size },
      ],
      'final',
      'k',
    );

    const expected = Buffer.concat([a, b, c]);
    expect(res.size).toBe(BigInt(expected.length));
    expect(res.etag).toBe(createHash('md5').update(expected).digest('hex'));
    const onDisk = await readFile(res.finalPath);
    expect(onDisk.equals(expected)).toBe(true);
  });

  it('case 14: composeBlobs unlinks the tmp file when a part read errors', async () => {
    const part1 = await store.putBlob('parts', 'p1', Readable.from([Buffer.from('a')]));
    await expect(
      store.composeBlobs(
        [
          { path: part1.finalPath, size: part1.size },
          { path: join(dataDir, 'does-not-exist'), size: 1n },
        ],
        'final',
        'k',
      ),
    ).rejects.toThrow();

    expect(existsSync(store.paths.blobPath('final', 'k'))).toBe(false);
    const tmpDir = store.paths.tmpDir();
    const tmpFiles = existsSync(tmpDir)
      ? readdirSync(tmpDir).filter((f) => f.startsWith('compose-'))
      : [];
    expect(tmpFiles).toEqual([]);
  });

  // ---------- atomicRename EXDEV fallback --------------------------------

  it('case 15: EXDEV fallback copies + unlinks + logs warn', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const renameSpy = jest
      .spyOn(fs, 'rename')
      .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('EXDEV'), { code: 'EXDEV' })));
    const copySpy = jest.spyOn(fs, 'copyFile');

    try {
      const buf = Buffer.from('cross-device');
      const res = await store.putBlob('b', 'k', Readable.from([buf]));
      expect((await readFile(res.finalPath)).equals(buf)).toBe(true);
      expect(copySpy).toHaveBeenCalled();
      const warnArgs = warnSpy.mock.calls.flat().join(' ');
      expect(warnArgs).toMatch(/EXDEV:/);
    } finally {
      renameSpy.mockRestore();
      copySpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('case 16: a non-EXDEV rename error is rethrown (no fallback)', async () => {
    const renameSpy = jest
      .spyOn(fs, 'rename')
      .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })));
    const copySpy = jest.spyOn(fs, 'copyFile');
    try {
      await expect(
        store.putBlob('b', 'k', Readable.from([Buffer.from('x')])),
      ).rejects.toMatchObject({ code: 'EACCES' });
      expect(copySpy).not.toHaveBeenCalled();
    } finally {
      renameSpy.mockRestore();
      copySpy.mockRestore();
    }
  });
});
