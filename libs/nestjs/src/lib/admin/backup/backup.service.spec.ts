import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import yauzl from 'yauzl';

import type { BucketService } from '../../domain/buckets/bucket.service';
import type { ObjectService } from '../../domain/objects/object.service';
import type { ObjectWriterService } from '../../storage/object-writer.service';
import type { BucketRepository } from '../../persistence/repositories/bucket.repository';
import type { ObjectRepository } from '../../persistence/repositories/object.repository';
import { BackupService } from './backup.service';

/**
 * TEST-0704 — restore decompression caps (TASK-2143, CWE-409/400) + manifest
 * read cap (TASK-2144, CWE-400/789). Archives are built on disk with archiver
 * and streamed back through the real yauzl-based restore path.
 */
const CAPS = {
  RESTORE_MAX_MANIFEST_BYTES: 4 * 1024 * 1024,
  RESTORE_MAX_ENTRY_BYTES: 5 * 1024 * 1024 * 1024,
  RESTORE_MAX_TOTAL_BYTES: 100 * 1024 * 1024 * 1024,
  RESTORE_MAX_ENTRIES: 1_000_000,
};

describe('BackupService restore caps (TEST-0704)', () => {
  let dataDir: string;
  let caps: Record<string, number>;
  const wipeSpy = jest.fn();

  const validManifest = () =>
    JSON.stringify({
      version: 1,
      kind: 'bucket',
      createdAt: new Date().toISOString(),
      buckets: [{ name: 'mybucket', versioning: 'disabled', objectLock: false, region: 'us-east-1' }],
      objects: [{ bucket: 'mybucket', key: 'f.txt', size: 5, etag: '', contentType: 'text/plain' }],
    });

  /** Build a .zip on disk from { name → Buffer } entries; returns its path. */
  async function makeZip(entries: Record<string, Buffer>): Promise<string> {
    const zipPath = join(dataDir, `archive-${randomUUID()}.zip`);
    const out = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.pipe(out);
    for (const [name, buf] of Object.entries(entries)) archive.append(buf, { name });
    await archive.finalize();
    await once(out, 'close');
    return zipPath;
  }

  function makeService(): BackupService {
    const config = {
      getOrThrow: (k: string) => (k === 'DATA_DIR' ? dataDir : caps[k]),
    } as unknown as ConfigService;

    const bucketRepo = {
      getByName: jest.fn().mockResolvedValue({ name: 'mybucket' }),
      exists: jest.fn().mockResolvedValue(false),
      listAll: jest.fn().mockResolvedValue([]),
    } as unknown as BucketRepository;
    const objectRepo = {
      listByPrefix: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    } as unknown as ObjectRepository;
    const buckets = { create: jest.fn().mockResolvedValue(undefined) } as unknown as BucketService;
    const objects = {
      // wipeBucketObjects → deleteOne; record that a wipe was attempted.
      deleteOne: jest.fn().mockImplementation(async () => wipeSpy()),
      setTaggingMap: jest.fn().mockResolvedValue(undefined),
    } as unknown as ObjectService;
    const writer = {
      put: jest.fn().mockResolvedValue({ size: 5n }),
    } as unknown as ObjectWriterService;

    return new BackupService(buckets, bucketRepo, objects, objectRepo, writer, config);
  }

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', 'openbucket-backup-test', randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
    caps = { ...CAPS };
    wipeSpy.mockClear();
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('TASK-2144: rejects an oversized manifest.json with 400 before parsing', async () => {
    caps.RESTORE_MAX_MANIFEST_BYTES = 64; // 64-byte cap
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()), // well over 64 bytes
      'data/mybucket/f.txt': Buffer.from('hello'),
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('TASK-2143: rejects a per-entry decompression bomb BEFORE wiping', async () => {
    caps.RESTORE_MAX_ENTRY_BYTES = 8; // tiny per-entry cap
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/f.txt': Buffer.alloc(1024, 0x41), // 1 KiB > 8 B cap
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The validation pass runs before the destructive wipe.
    expect(wipeSpy).not.toHaveBeenCalled();
  });

  it('TASK-2143: rejects when total decompressed bytes exceed the cap, before wiping', async () => {
    caps.RESTORE_MAX_TOTAL_BYTES = 8;
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/f.txt': Buffer.alloc(1024, 0x42),
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(wipeSpy).not.toHaveBeenCalled();
  });

  it('TASK-2143: rejects an archive with more than RESTORE_MAX_ENTRIES payload entries', async () => {
    caps.RESTORE_MAX_ENTRIES = 1;
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/a.txt': Buffer.from('a'),
      'data/mybucket/b.txt': Buffer.from('b'),
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(wipeSpy).not.toHaveBeenCalled();
  });

  it('restores a within-limits archive successfully', async () => {
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/f.txt': Buffer.from('hello'), // 5 bytes, matches manifest size
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).resolves.toEqual({
      objectsRestored: 1,
    });
  });
});

/**
 * TEST-1203 (case 1) — the sink-based `writeSnapshot` seam (TASK-3630). Writes a
 * snapshot to a file on disk (the shape the scheduled runner uses) and re-reads
 * the manifest + payload entries back out of the archive.
 */
describe('BackupService.writeSnapshot (TEST-1203)', () => {
  let dataDir: string;

  /** Read a single entry's bytes out of a .zip on disk (manifest / payload). */
  function readEntry(zipPath: string, name: string): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
        if (err || !zf) return reject(err ?? new Error('no zipfile'));
        let found = false;
        zf.on('entry', (entry: yauzl.Entry) => {
          if (entry.fileName !== name) return zf.readEntry();
          found = true;
          zf.openReadStream(entry, (e, rs) => {
            if (e || !rs) return reject(e ?? new Error('no stream'));
            const chunks: Buffer[] = [];
            rs.on('data', (c: Buffer) => chunks.push(c));
            rs.on('end', () => resolve(Buffer.concat(chunks)));
          });
        });
        zf.on('end', () => (found ? undefined : resolve(null)));
        zf.readEntry();
      });
    });
  }

  function makeService(rows: Array<{ key: string; body: string }>): BackupService {
    const config = { getOrThrow: (k: string) => (k === 'DATA_DIR' ? dataDir : 0) } as unknown as ConfigService;
    const bucketRepo = {
      getByName: jest.fn().mockResolvedValue({ name: 'mybucket', region: 'us-east-1' }),
      listAll: jest.fn().mockResolvedValue([{ name: 'mybucket' }]),
    } as unknown as BucketRepository;
    const objectRepo = {
      listByPrefix: jest.fn().mockResolvedValue({
        rows: rows.map((r) => ({
          key: r.key,
          size: BigInt(r.body.length),
          etag: 'e',
          contentType: 'text/plain',
          softDeleted: false,
        })),
        truncated: false,
      }),
    } as unknown as ObjectRepository;
    const objects = {
      openObjectStream: jest.fn().mockImplementation(async (_b: string, key: string) => {
        const row = rows.find((r) => r.key === key);
        return row ? { stream: Readable.from([Buffer.from(row.body)]), size: row.body.length } : null;
      }),
    } as unknown as ObjectService;
    const buckets = {} as unknown as BucketService;
    const writer = {} as unknown as ObjectWriterService;
    return new BackupService(buckets, bucketRepo, objects, objectRepo, writer, config);
  }

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', 'openbucket-snapshot-test', randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('writes a byte-counted snapshot to a file sink and the manifest round-trips', async () => {
    const svc = makeService([{ key: 'f.txt', body: 'hello world' }]);
    const zipPath = join(dataDir, 'snap.zip');
    const ws = createWriteStream(zipPath);

    const result = await svc.writeSnapshot(ws, 'instance', ['mybucket']);
    await once(ws, 'close');

    expect(result.objectCount).toBe(1);
    expect(result.bytes).toBeGreaterThan(0);

    const manifestBuf = await readEntry(zipPath, 'manifest.json');
    expect(manifestBuf).not.toBeNull();
    const manifest = JSON.parse((manifestBuf as Buffer).toString('utf8'));
    expect(manifest.version).toBe(1);
    expect(manifest.kind).toBe('instance');
    expect(manifest.buckets).toEqual([
      { name: 'mybucket', versioning: 'disabled', objectLock: false, region: 'us-east-1' },
    ]);
    expect(manifest.objects.map((o: { key: string }) => o.key)).toEqual(['f.txt']);

    const payload = await readEntry(zipPath, 'data/mybucket/f.txt');
    expect((payload as Buffer).toString('utf8')).toBe('hello world');
  });

  it('an empty instance still writes a valid manifest with empty arrays', async () => {
    const svc = makeService([]);
    const zipPath = join(dataDir, 'empty.zip');
    const ws = createWriteStream(zipPath);
    const result = await svc.writeSnapshot(ws, 'instance', []);
    await once(ws, 'close');
    expect(result.objectCount).toBe(0);
    const manifest = JSON.parse((await readEntry(zipPath, 'manifest.json') as Buffer).toString('utf8'));
    expect(manifest.buckets).toEqual([]);
    expect(manifest.objects).toEqual([]);
  });
});
